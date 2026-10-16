import { BusinessProfiles, Contacts, Icps } from '@sutra/db';
import type { BusinessProfileDoc, Country, IcpDoc, Id, Source } from '@sutra/domain';
import {
  collectLeads,
  enabledLeadSources,
  leadSourceById,
  type SourceContext,
} from '@sutra/sources';
import type { NodeContext, NodeResult } from '../pipeline/define.ts';
import { recordStep, reportProgress } from '../pipeline/recorder.ts';
import { findContacts } from './contact-finder.ts';
import { buildSourceContext, prospectorDeps } from './deps.ts';
import { upsertCompanyDraft, upsertContactDraft } from './upsert.ts';

const latest = { sort: { version: -1 }, limit: 1 } as const;

/** The ICP and profile prospecting runs against: the latest confirmed version, else the latest. */
async function confirmedInputs(
  workspaceId: Id,
): Promise<{ icp?: IcpDoc; profile?: BusinessProfileDoc }> {
  const [icps, profiles] = await Promise.all([
    Icps.find(workspaceId, {}, latest),
    BusinessProfiles.find(workspaceId, {}, latest),
  ]);
  return { icp: icps[0], profile: profiles[0] };
}

/**
 * The `prospector` node's fan-out: one child per enabled source, so each lead source shows up as a
 * prospector sub-agent in the agent graph. Sources with nothing to plan (e.g. Places for a
 * non-local ICP) are dropped, and optional paid sources appear only with the flag and a key.
 */
export async function enabledProspectorSources(ctx: NodeContext): Promise<string[]> {
  const { icp, profile } = await confirmedInputs(ctx.workspaceId);
  if (!icp || !profile) return [];
  const sctx = await buildSourceContext(ctx.workspaceId);
  sctx.icp = icp;
  return enabledLeadSources(sctx)
    .filter((source) => source.plan(icp, profile).length > 0)
    .map((source) => source.id);
}

/**
 * Runs one lead source (a fan-out child): plan queries from the ICP within the per-run budget,
 * stream drafts, and normalise → dedupe → upsert them. For free sources, companies with no contact
 * yet go through the contact finder. Returns a one-line summary for the graph.
 */
export async function runProspectorSource(ctx: NodeContext): Promise<NodeResult> {
  const { workspaceId, item } = ctx;
  if (!item) return { summary: 'No source' };
  const source = leadSourceById.get(item as Source);
  if (!source) throw new Error(`Unknown lead source "${item}"`);

  const { icp, profile } = await confirmedInputs(workspaceId);
  if (!icp || !profile) return { summary: 'No confirmed ICP' };

  const deps = prospectorDeps();
  const sctx: SourceContext = { ...(await buildSourceContext(workspaceId, deps)), icp };
  const fallbackCountry: Country = icp.firmographics.countries[0] ?? 'US';

  let companies = 0;
  let contacts = 0;
  const foundWithDomain = new Map<string, { companyId: Id; name: string; domain: string }>();

  for await (const draft of collectLeads(source, sctx, icp, profile)) {
    if (draft.kind === 'company') {
      const up = await upsertCompanyDraft(workspaceId, draft, fallbackCountry);
      if (up.created) companies++;
      if (up.domain)
        foundWithDomain.set(up.domain, {
          companyId: up.companyId,
          name: draft.name,
          domain: up.domain,
        });
      await reportProgress(companies);
    } else if (await upsertContactDraft(workspaceId, draft, fallbackCountry)) {
      contacts++;
    }
  }

  // Contact discovery for free sources; paid sources bring their provider's contacts and emails.
  if (source.cost !== 'paid') {
    for (const company of foundWithDomain.values()) {
      if (await Contacts.count(workspaceId, { companyId: company.companyId })) continue;
      const drafts = await recordStep(
        'contactFinder',
        () =>
          findContacts({
            workspaceId,
            company: { name: company.name, domain: company.domain },
            personas: icp.personas,
            source: source.id,
            deps,
          }),
        (found) => `${found.length} at ${company.domain}`,
      );
      for (const draft of drafts)
        if (await upsertContactDraft(workspaceId, draft, fallbackCountry)) contacts++;
    }
  }

  return { summary: `${companies} companies · ${contacts} contacts` };
}
