import { audit, Companies, Contacts, Icps, Suppressions } from '@sutra/db';
import type { Company, Contact, Country, IcpDoc, Id } from '@sutra/domain';
import type { NodeContext, NodeResult } from '../pipeline/define.ts';
import { recordStep, reportProgress } from '../pipeline/recorder.ts';
import { untrusted } from '../prompts/base.ts';
import { findContacts } from '../prospector/contact-finder.ts';
import { prospectorDeps } from '../prospector/deps.ts';
import { upsertContactDraft } from '../prospector/upsert.ts';
import { runAgent } from '../run.ts';
import { type EnricherDeps, enricherDeps } from './deps.ts';
import { blendScore, preFilter, rulesScore } from './scoring.ts';

/** Per-run budget, so one enrichment pass stays inside the free-tier grounding and LLM quotas. */
export const ENRICH_BUDGET = {
  /** Most companies scored in one pass. */
  maxCompanies: 50,
  /** Companies researched/scored at once (the job-queue concurrency limit). */
  concurrency: 3,
  /** Wall-clock budget; the pass then stops with partial results. */
  timeBudgetMs: 10 * 60_000,
} as const;

/** Research is cached per company for 30 days to protect the grounding quota. */
const RESEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const latest = { sort: { version: -1 }, limit: 1 } as const;

const confirmedIcp = async (workspaceId: Id): Promise<IcpDoc | undefined> =>
  (await Icps.find(workspaceId, {}, latest))[0];

/** Runs `work` over `items` with at most `limit` in flight (a simple job queue). */
async function pool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const item = items[i++];
      if (item !== undefined) await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function scorerInput(
  company: Company,
  contacts: Contact[],
  icp: IcpDoc,
  researchText: string,
): string {
  const personas = [...new Set(contacts.map((c) => c.personaMatch).filter(Boolean))];
  return [
    `Company: ${company.name}${company.domain ? ` (${company.domain})` : ''}`,
    `Location: ${[company.city, company.country].filter(Boolean).join(', ') || 'unknown'}`,
    company.industry && `Industry: ${company.industry}`,
    company.size && `Company size: ${company.size}`,
    `Matched ICP personas: ${personas.join(', ') || 'none'}`,
    `ICP industries: ${icp.firmographics.industries.join(', ')}`,
    `ICP countries: ${icp.firmographics.countries.join(', ')}`,
    `ICP buying signals: ${icp.buyingSignals.join('; ') || 'none'}`,
    `Research:\n${untrusted(researchText, 'research')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The `enrich` pipeline node. For each company (within a concurrency limit and per-run budget):
 * run the deterministic pre-filter — a country outside the ICP, a disqualifier keyword or a
 * suppressed domain is disqualified here with **no LLM call** — then the contact finder (for
 * companies still without contacts), the cached researcher and the scorer, and persist the blended
 * score. The run then advances to the copywriter once every company is scored, or when the time
 * budget is spent, with partial results.
 */
export async function runEnricher(ctx: NodeContext): Promise<NodeResult> {
  const { workspaceId } = ctx;
  const icp = await confirmedIcp(workspaceId);
  if (!icp) return { summary: 'No confirmed ICP' };

  const deps: EnricherDeps = enricherDeps();
  const pdeps = prospectorDeps();
  const fallbackCountry: Country = icp.firmographics.countries[0] ?? 'US';

  const suppressedDomains = new Set(
    (await Suppressions.find(workspaceId, { scope: 'domain' })).map((s) => s.value.toLowerCase()),
  );
  // Already-disqualified and user-excluded companies are left as they are (and cost no tokens).
  const companies = (
    await Companies.find(workspaceId, { status: { $in: ['new', 'enriched', 'scored'] } })
  ).slice(0, ENRICH_BUDGET.maxCompanies);

  const deadline = Date.now() + ENRICH_BUDGET.timeBudgetMs;
  let scored = 0;
  let disqualified = 0;
  let done = 0;

  await pool(companies, ENRICH_BUDGET.concurrency, async (company) => {
    if (Date.now() > deadline) return; // Partial results: stop starting new work past the budget.

    const dq = preFilter({ company, icp, suppressedDomains });
    if (dq) {
      await Companies.update(workspaceId, company._id, {
        status: 'disqualified',
        fit: dq.fit,
        score: dq.score,
        scoreReasons: dq.reasons,
      });
      await audit(workspaceId, { kind: 'agent', id: 'scorer' }, 'company.disqualified', {
        entity: 'company',
        entityId: company._id,
        data: { reason: dq.reasons[0]?.evidence },
      });
      disqualified++;
      await reportProgress(++done, companies.length);
      return;
    }

    // Contact discovery for any company still without contacts (PR 08's finder).
    const domain = company.domain;
    if (domain && !(await Contacts.count(workspaceId, { companyId: company._id }))) {
      const drafts = await recordStep(
        'contactFinder',
        () =>
          findContacts({
            workspaceId,
            company: { name: company.name, domain, website: company.website },
            personas: icp.personas,
            source: company.sources[0]?.source ?? 'search',
            deps: pdeps,
          }),
        (found) => `${found.length} contacts`,
      );
      for (const draft of drafts) await upsertContactDraft(workspaceId, draft, fallbackCountry);
    }
    const contacts = await Contacts.find(workspaceId, { companyId: company._id });

    // Research, cached per company for 30 days.
    const fresh =
      company.research &&
      company.researchedAt &&
      Date.now() - company.researchedAt.getTime() < RESEARCH_TTL_MS;
    const research = fresh
      ? company.research
      : await recordStep(
          'researcher',
          () =>
            deps.researcher.research({
              name: company.name,
              domain: company.domain ?? company.normalizedName,
              website: company.website,
              summary: company.industry,
              buyingSignals: icp.buyingSignals,
            }),
          (r) => (r ? `${r.signals.length} signals` : 'no research'),
        );

    const researchText = research
      ? [
          research.summary,
          ...research.signals.map((s) => `- [${s.kind}] ${s.text} (${s.sourceUrl})`),
        ]
          .filter(Boolean)
          .join('\n')
      : '(no external research available)';

    const { output: llm } = await runAgent({
      agent: deps.scorer,
      workspaceId,
      sessionKey: `scorer:${workspaceId}:${company._id}`,
      input: scorerInput(company, contacts, icp, researchText),
    });
    const rules = rulesScore({ sources: company.sources, contacts, icp, research }, deps.weights);
    const score = blendScore(llm, rules, deps.weights);

    await Companies.update(workspaceId, company._id, {
      ...(research && !fresh && { research, researchedAt: new Date() }),
      score: score.score,
      fit: score.fit,
      scoreReasons: score.reasons,
      status: 'scored',
    });

    // Locale follows the website language when research found it; it drives the copywriter later.
    if (research?.websiteLanguage)
      for (const c of contacts)
        if (c.locale !== research.websiteLanguage)
          await Contacts.update(workspaceId, c._id, { locale: research.websiteLanguage });

    await audit(workspaceId, { kind: 'agent', id: 'scorer' }, 'company.scored', {
      entity: 'company',
      entityId: company._id,
      data: { score: score.score, fit: score.fit },
    });
    scored++;
    await reportProgress(++done, companies.length);
  });

  return { summary: `${scored} scored · ${disqualified} disqualified` };
}
