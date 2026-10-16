import { BusinessProfiles, Campaigns, Contacts, Icps, newId } from '@sutra/db';
import type {
  BusinessProfile,
  BusinessProfileDoc,
  CampaignStep,
  CampaignVariant,
  IcpDoc,
  Id,
  Locale,
  Persona,
  SequencePlan,
  Variant,
} from '@sutra/domain';
import type { NodeContext, NodeResult } from '../pipeline/define.ts';
import { recordStep, reportProgress } from '../pipeline/recorder.ts';
import { brandVoice, companyProfile, localeRules } from '../prompts/base.ts';
import { runAgent } from '../run.ts';
import { type CopywriterDeps, copywriterDeps } from './deps.ts';
import { qualityGate } from './quality-gate.ts';

/** At most this many locales are translated per variant, to protect the free-tier LLM quota. */
export const MAX_TRANSLATION_LOCALES = 3;

const latest = { sort: { version: -1 }, limit: 1 } as const;
const confirmed = { status: 'confirmed' as const };

const confirmedProfile = async (workspaceId: Id): Promise<BusinessProfileDoc | undefined> =>
  (await BusinessProfiles.find(workspaceId, confirmed, latest))[0];
const confirmedIcp = async (workspaceId: Id): Promise<IcpDoc | undefined> =>
  (await Icps.find(workspaceId, confirmed, latest))[0];

const personaContext = (persona: Persona): string =>
  [
    `Target persona: ${persona.title} (${persona.seniority})`,
    persona.pains.length && `Pains: ${persona.pains.join('; ')}`,
    persona.goals.length && `Goals: ${persona.goals.join('; ')}`,
    persona.objections.length && `Objections: ${persona.objections.join('; ')}`,
  ]
    .filter(Boolean)
    .join('\n');

const profileContext = (profile: BusinessProfile): string =>
  [companyProfile(profile), brandVoice(profile.toneOfVoice)].join('\n\n');

/** Locales (other than English) of the scored contacts that match this persona, capped for quota. */
async function targetLocales(workspaceId: Id, persona: Persona): Promise<Locale[]> {
  const contacts = await Contacts.find(workspaceId, { personaMatch: persona.title });
  const locales = [...new Set(contacts.map((c) => c.locale))].filter((l) => l !== 'en');
  return locales.slice(0, MAX_TRANSLATION_LOCALES);
}

/** Runs the variant writer for one step and applies the quality gate (one regeneration on failure). */
async function writeVariants(
  deps: CopywriterDeps,
  workspaceId: Id,
  sessionKey: string,
  input: string,
): Promise<Variant[]> {
  const { output } = await runAgent({ agent: deps.variantWriter, workspaceId, sessionKey, input });
  const gated = output.variants.map((v) => ({ variant: v, gate: qualityGate(v) }));
  if (gated.every((g) => g.gate.ok)) return gated.map((g) => g.variant);

  // One regeneration, telling the writer exactly why the gate rejected the pair.
  const reasons = gated
    .flatMap((g, i) => g.gate.reasons.map((r) => `Variant ${i === 0 ? 'A' : 'B'}: ${r}`))
    .join('; ');
  const retry = await runAgent({
    agent: deps.variantWriter,
    workspaceId,
    sessionKey,
    input: `${input}\n\nYour previous draft failed the quality gate: ${reasons}. Rewrite both variants to fix this.`,
  });
  return retry.output.variants;
}

/** Translates one template into each target locale; a locale that fails is skipped, not fatal. */
async function translateVariant(
  deps: CopywriterDeps,
  workspaceId: Id,
  variant: Variant,
  locales: readonly Locale[],
): Promise<CampaignVariant['translations']> {
  const entries = await Promise.all(
    locales.map(async (locale) => {
      try {
        const { output } = await runAgent({
          agent: deps.translator,
          workspaceId,
          sessionKey: `translator:${workspaceId}:${newId()}`,
          input: [
            localeRules(locale),
            `Translate this template:\nSubject: ${variant.subject}\nBody:\n${variant.body}`,
          ].join('\n\n'),
        });
        return [locale, output] as const;
      } catch {
        return undefined;
      }
    }),
  );
  const translations = Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => !!e));
  return Object.keys(translations).length ? translations : undefined;
}

/** Turns a planned step plus its written, gated, translated variants into a stored campaign step. */
const toCampaignVariant = (variant: Variant, translations: CampaignVariant['translations']) => {
  const gate = qualityGate(variant);
  return {
    ...variant,
    id: newId(),
    status: 'draft' as const,
    origin: 'initial' as const,
    ...(translations && { translations }),
    ...(gate.ok ? {} : { flags: gate.reasons }),
  } satisfies CampaignVariant;
};

/**
 * The `copywriter` pipeline node. For each ICP persona without a campaign yet, plans the sequence
 * (`sequencePlanner`), writes two A/B template variants per step (`variantWriter`), runs the
 * deterministic `qualityGate` (one regeneration on failure, otherwise flagged for the reviewer),
 * translates each template into the locales of that persona's contacts, and saves one draft campaign
 * per persona — ready for checkpoint 2. Deterministic control flow; the LLM only writes language.
 */
export async function runCopywriter(ctx: NodeContext): Promise<NodeResult> {
  const { workspaceId } = ctx;
  const [profileDoc, icp] = await Promise.all([
    confirmedProfile(workspaceId),
    confirmedIcp(workspaceId),
  ]);
  if (!profileDoc) return { summary: 'No confirmed profile' };
  if (!icp) return { summary: 'No confirmed ICP' };

  const deps = copywriterDeps();
  const existing = await Campaigns.find(workspaceId, { icpVersion: icp.version });
  const done = new Set(existing.map((c) => c.persona));

  let created = 0;
  await reportProgress(0, icp.personas.length);
  for (const [i, persona] of icp.personas.entries()) {
    if (done.has(persona.title)) {
      await reportProgress(i + 1, icp.personas.length);
      continue;
    }

    const context = [profileContext(profileDoc), personaContext(persona)].join('\n\n');
    const { output: plan } = await runAgent({
      agent: deps.sequencePlanner,
      workspaceId,
      sessionKey: `sequencePlanner:${workspaceId}:${icp.version}:${persona.title}`,
      input: [
        context,
        icp.buyingSignals.length && `Observed buying signals: ${icp.buyingSignals.join('; ')}`,
        'Plan the outreach sequence for this persona.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

    const locales = await targetLocales(workspaceId, persona);
    const steps = await buildSteps(deps, workspaceId, icp.version, persona, context, plan, locales);

    await Campaigns.create(workspaceId, {
      name: `${persona.title} — ${profileDoc.name}`,
      icpVersion: icp.version,
      persona: persona.title,
      steps,
      status: 'draft',
    });
    created++;
    await reportProgress(i + 1, icp.personas.length);
  }

  return {
    summary: created ? `${created} campaign${created > 1 ? 's' : ''} drafted` : 'Up to date',
  };
}

/** The variant-writer prompt for one step (optionally with a reviewer's regeneration note). */
const stepInput = (
  context: string,
  index: number,
  total: number,
  intent: string,
  angle: string,
  note?: string,
): string =>
  [
    context,
    `This is step ${index + 1} of ${total}. Intent: ${intent}. Angle: ${angle}.`,
    'Write the two A/B variants for this step.',
    note && `Reviewer note: ${note}`,
  ]
    .filter(Boolean)
    .join('\n\n');

/** Writes, gates and translates the two stored variants for one step. */
async function variantsForStep(
  deps: CopywriterDeps,
  workspaceId: Id,
  sessionKey: string,
  input: string,
  locales: readonly Locale[],
): Promise<CampaignVariant[]> {
  const variants = await writeVariants(deps, workspaceId, sessionKey, input);
  await recordStep(
    'qualityGate',
    async () => variants.map((v) => qualityGate(v)),
    (results) => `${results.filter((r) => r.ok).length}/${results.length} passed`,
  );
  return Promise.all(
    variants.map(async (v) =>
      toCampaignVariant(v, await translateVariant(deps, workspaceId, v, locales)),
    ),
  );
}

async function buildSteps(
  deps: CopywriterDeps,
  workspaceId: Id,
  icpVersion: number,
  persona: Persona,
  context: string,
  plan: SequencePlan,
  locales: readonly Locale[],
): Promise<CampaignStep[]> {
  const steps: CampaignStep[] = [];
  for (const [index, step] of plan.steps.entries()) {
    const sessionKey = `variantWriter:${workspaceId}:${icpVersion}:${persona.title}:${index}`;
    const input = stepInput(context, index, plan.steps.length, step.intent, step.angle);
    const variants = await variantsForStep(deps, workspaceId, sessionKey, input, locales);
    steps.push({ delayDays: step.delayDays, intent: step.intent, angle: step.angle, variants });
  }
  return steps;
}

/**
 * Regenerates both A/B variants of one campaign step from a reviewer's note (the "Regenerate with
 * note" action). Variant pairs are regenerated together so they keep differing in exactly one
 * dimension. The step's timing/intent/angle are preserved; the new variants are fresh drafts, so
 * any prior approval of that step is void. Returns the updated campaign, or `undefined` if not found.
 */
export async function regenerateStep(input: {
  workspaceId: Id;
  campaignId: Id;
  stepIndex: number;
  note?: string;
  deps?: CopywriterDeps;
}): Promise<CampaignStep | undefined> {
  const { workspaceId, campaignId, stepIndex, note } = input;
  const campaign = await Campaigns.get(workspaceId, campaignId);
  const step = campaign?.steps[stepIndex];
  if (!campaign || !step) return undefined;

  const [profileDoc, icp] = await Promise.all([
    confirmedProfile(workspaceId),
    confirmedIcp(workspaceId),
  ]);
  if (!profileDoc || !icp) return undefined;
  const persona = icp.personas.find((p) => p.title === campaign.persona) ?? icp.personas[0];
  if (!persona) return undefined;

  const deps = input.deps ?? copywriterDeps();
  const context = [profileContext(profileDoc), personaContext(persona)].join('\n\n');
  const prompt = stepInput(
    context,
    stepIndex,
    campaign.steps.length,
    step.intent ?? 'value',
    step.angle ?? '',
    note,
  );
  const locales = await targetLocales(workspaceId, persona);
  const variants = await variantsForStep(
    deps,
    workspaceId,
    `variantWriter:${workspaceId}:regen:${campaignId}:${stepIndex}:${newId()}`,
    prompt,
    locales,
  );

  const steps = campaign.steps.map((s, i) => (i === stepIndex ? { ...s, variants } : s));
  await Campaigns.update(workspaceId, campaignId, { steps });
  return { ...step, variants };
}
