import {
  BusinessProfiles,
  Campaigns,
  Icps,
  metricsFor,
  newId,
  retireVariant,
  variantMetrics,
} from '@sutra/db';
import type {
  Campaign,
  CampaignStep,
  CampaignVariant,
  Id,
  OptimizerInsight,
  Reward,
  VariantDimension,
  VariantMetrics,
} from '@sutra/domain';
import { rewardSuccesses, variantDimension } from '@sutra/domain';
import { qualityGate } from '../copywriter/quality-gate.ts';
import { defineJob, type JobPayload } from '../jobs.ts';
import type { NodeContext, NodeResult } from '../pipeline/define.ts';
import { reportProgress } from '../pipeline/recorder.ts';
import { brandVoice, companyProfile } from '../prompts/base.ts';
import { runAgent } from '../run.ts';
import {
  type ArmEvaluation,
  type ArmStats,
  DEFAULT_DRAWS,
  evaluateArms,
  MIN_CONFIDENT_SENDS,
  type Rng,
} from './bandit.ts';
import { type OptimizerDeps, optimizerDeps } from './deps.ts';

/** The job the optimizer runs under (cron `maintenance` and after every N sends per campaign). */
export const OPTIMIZER_JOB = 'optimizer';
/** The optimizer is kicked once per this many sends per campaign (spec §3), plus the daily cron. */
export const OPTIMIZER_SEND_INTERVAL = 50;
/** A step's best arm has "stalled" only once the step has at least this many sends. */
export const CHALLENGER_MIN_SENDS = 50;
/** At most this many new challengers per optimizer run, to protect the free-tier LLM quota. */
export const MAX_CHALLENGERS_PER_RUN = 2;

const letter = (index: number) => String.fromCharCode(65 + index);
const pct = (p: number) => Math.round(p * 100);
const rewardLabel: Record<Reward, string> = {
  positive_reply: 'positive replies',
  reply: 'replies',
  click: 'clicks',
};

export interface OptimizeResult {
  campaignId: Id;
  retired: number;
  challengers: number;
  winners: number;
  insights: OptimizerInsight[];
}

/** The active (sendable) arms of a step as bandit stats for the campaign's reward metric. */
function stepArms(
  step: CampaignStep,
  metrics: Map<string, VariantMetrics>,
  reward: Reward,
): { variant: CampaignVariant; stats: ArmStats; metrics: VariantMetrics }[] {
  return step.variants
    .filter((v) => v.status === 'active')
    .map((v) => {
      const m = metricsFor(metrics, v.id);
      return {
        variant: v,
        metrics: m,
        stats: { id: v.id, sends: m.sent, successes: rewardSuccesses(m, reward) },
      };
    });
}

/** The arm with the highest P(best); ties break on the first. */
const leaderOf = (evals: ArmEvaluation[]): ArmEvaluation | undefined =>
  evals.reduce<ArmEvaluation | undefined>(
    (best, e) => (!best || e.pBest > best.pBest ? e : best),
    undefined,
  );

/** A dimension to change for a challenger: the first that isn't the current best arm's dimension. */
function challengerDimension(current: VariantDimension): VariantDimension {
  return variantDimension.options.find((d) => d !== current) ?? current;
}

/**
 * Builds the deterministic insights for a campaign from its arms' current numbers. Every insight
 * cites the data it is based on (acceptance criterion): sends, rewards and win probability.
 */
function buildInsights(
  campaign: Campaign,
  metrics: Map<string, VariantMetrics>,
  evalsByStep: ArmEvaluation[][],
  now: Date,
): OptimizerInsight[] {
  const insights: OptimizerInsight[] = [];
  const label = rewardLabel[campaign.reward];

  campaign.steps.forEach((step, stepIndex) => {
    const evals = evalsByStep[stepIndex] ?? [];
    if (evals.length < 2) return;
    const leader = leaderOf(evals);
    if (!leader?.enoughData) return;
    const variant = step.variants.find((v) => v.id === leader.id);
    if (!variant) return;
    const index = step.variants.findIndex((v) => v.id === leader.id);
    const m = metricsFor(metrics, leader.id);
    const rewards = rewardSuccesses(m, campaign.reward);
    const crown = leader.winner ? ' — a clear winner' : '';
    insights.push({
      text: `Step ${stepIndex + 1}: variant ${letter(index)} (${variant.dimension}) leads at P(best) ${pct(leader.pBest)}% on ${m.sent} sends, ${rewards} ${label}${crown}.`,
      stepIndex,
      at: now,
    });
  });

  // Campaign-level reply summary — always cites its numbers.
  const totals = campaign.steps
    .flatMap((s) => s.variants)
    .reduce(
      (acc, v) => {
        const m = metricsFor(metrics, v.id);
        acc.sent += m.sent;
        acc.replies += m.replies;
        acc.positive += m.positiveReplies;
        return acc;
      },
      { sent: 0, replies: 0, positive: 0 },
    );
  if (totals.sent > 0)
    insights.push({
      text: `${totals.replies} replies (${totals.positive} positive) from ${totals.sent} sends so far.`,
      at: now,
    });

  return insights;
}

/**
 * One optimizer pass over a campaign (PR 15): aggregate per-variant metrics, run the Thompson bandit
 * to get each arm's P(best), auto-retire losers (P(best) < 5% with ≥ 50 sends), record data-cited
 * insights, and — for any step whose best arm has stalled without a winner — write an AI challenger
 * that changes one dimension of the best variant. Challengers land as `pending_approval`; the engine
 * never sends them until a person approves (enforced by the approved-variant permit). Returns a
 * summary, or `null` if the campaign is missing. Deterministic given `rng`; the LLM only writes copy.
 */
export async function optimizeCampaign(
  workspaceId: Id,
  campaignId: Id,
  opts: { now?: Date; rng?: Rng; draws?: number; deps?: OptimizerDeps } = {},
): Promise<OptimizeResult | null> {
  const campaign = await Campaigns.get(workspaceId, campaignId);
  if (!campaign) return null;
  const now = opts.now ?? new Date();
  const draws = opts.draws ?? DEFAULT_DRAWS;
  const deps = opts.deps ?? optimizerDeps();

  const metrics = await variantMetrics(workspaceId);
  const armsByStep = campaign.steps.map((s) => stepArms(s, metrics, campaign.reward));
  const evalsByStep = armsByStep.map((arms) =>
    arms.length
      ? evaluateArms(
          arms.map((a) => a.stats),
          draws,
          opts.rng,
        )
      : [],
  );

  // Auto-retire losers (retiring only ever reduces what's sent, so it is automatic).
  let retired = 0;
  for (const [stepIndex, evals] of evalsByStep.entries()) {
    for (const e of evals)
      if (e.retire) {
        await retireVariant(workspaceId, { campaignId, stepIndex, variantId: e.id });
        retired++;
      }
  }
  const winners = evalsByStep.flat().filter((e) => e.winner).length;

  const insights = buildInsights(campaign, metrics, evalsByStep, now);

  // Propose challengers for stalled steps (enough sends, no winner, room for another arm).
  const challengers: { stepIndex: number; variant: CampaignVariant }[] = [];
  const context = await campaignContext(workspaceId, campaign);
  for (const [stepIndex, arms] of armsByStep.entries()) {
    if (challengers.length >= MAX_CHALLENGERS_PER_RUN) break;
    const step = campaign.steps[stepIndex];
    if (!step) continue;
    if (!stepStalled(step, arms, evalsByStep[stepIndex] ?? [])) continue;
    const leader = leaderOf(evalsByStep[stepIndex] ?? []);
    const best = arms.find((a) => a.variant.id === leader?.id);
    if (!best) continue;

    const challenger = await writeChallenger({
      workspaceId,
      campaignId,
      stepIndex,
      step,
      context,
      best,
      reward: campaign.reward,
      pBest: leader?.pBest ?? 0,
      deps,
    });
    if (challenger) challengers.push({ stepIndex, variant: challenger });
  }

  // One write for the new challengers and the refreshed insights (retire already persisted above).
  if (challengers.length || insights.length) {
    const current = (await Campaigns.get(workspaceId, campaignId)) ?? campaign;
    const steps = current.steps.map((s, i) => {
      const added = challengers.filter((c) => c.stepIndex === i).map((c) => c.variant);
      return added.length ? { ...s, variants: [...s.variants, ...added] } : s;
    });
    await Campaigns.update(workspaceId, campaignId, { steps, insights });
  }

  return { campaignId, retired, challengers: challengers.length, winners, insights };
}

/** A step is a challenger candidate: ≥ 2 active arms, enough sends, no winner yet, room, none pending. */
function stepStalled(
  step: CampaignStep,
  arms: ReturnType<typeof stepArms>,
  evals: ArmEvaluation[],
): boolean {
  if (arms.length < 2 || arms.length >= 4) return false;
  const totalSends = arms.reduce((n, a) => n + a.stats.sends, 0);
  if (totalSends < CHALLENGER_MIN_SENDS) return false;
  const leader = leaderOf(evals);
  if (!leader?.enoughData || leader.winner) return false;
  // Idempotency: don't stack another suggestion while one is already waiting for approval.
  const alreadyPending = step.variants.some(
    (v) => v.origin === 'optimizer' && (v.status === 'pending_approval' || v.status === 'draft'),
  );
  return !alreadyPending;
}

/** The profile + persona context the challenger writer grounds its copy in. */
async function campaignContext(workspaceId: Id, campaign: Campaign): Promise<string> {
  const latest = { sort: { version: -1 }, limit: 1 } as const;
  const [profileDoc] = await BusinessProfiles.find(workspaceId, { status: 'confirmed' }, latest);
  const [icp] = await Icps.find(workspaceId, { status: 'confirmed' }, latest);
  const persona = icp?.personas.find((p) => p.title === campaign.persona) ?? icp?.personas[0];
  return [
    profileDoc && companyProfile(profileDoc),
    profileDoc && brandVoice(profileDoc.toneOfVoice),
    persona && `Target persona: ${persona.title} (${persona.seniority}).`,
    persona?.pains.length && `Pains: ${persona.pains.join('; ')}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Writes one challenger variant for a stalled step via the LLM seam; returns it as pending approval. */
async function writeChallenger(input: {
  workspaceId: Id;
  campaignId: Id;
  stepIndex: number;
  step: CampaignStep;
  context: string;
  best: ReturnType<typeof stepArms>[number];
  reward: Reward;
  pBest: number;
  deps: OptimizerDeps;
}): Promise<CampaignVariant | undefined> {
  const { workspaceId, campaignId, stepIndex, step, context, best, reward, pBest, deps } = input;
  const changeDim = challengerDimension(best.variant.dimension);
  const rewards = rewardSuccesses(best.metrics, reward);
  const prompt = [
    context,
    `This is step ${stepIndex + 1}${step.intent ? `. Intent: ${step.intent}` : ''}${step.angle ? `. Angle: ${step.angle}` : ''}.`,
    `Current best variant, dimension "${best.variant.dimension}":\nSubject: ${best.variant.subject}\nBody:\n${best.variant.body}`,
    `It has ${best.metrics.sent} sends and ${rewards} ${rewardLabel[reward]}, P(best) ${pct(pBest)}%. It has stalled without a clear winner.`,
    `Write ONE challenger that changes the "${changeDim}" dimension and keeps everything else matched.`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const { output } = await runAgent({
    agent: deps.challengerWriter,
    workspaceId,
    sessionKey: `challenger:${campaignId}:${stepIndex}:${newId()}`,
    input: prompt,
  });
  const gate = qualityGate(output);
  return {
    ...output,
    dimension: changeDim,
    id: newId(),
    status: 'pending_approval',
    origin: 'optimizer',
    parentId: best.variant.id,
    ...(gate.ok ? {} : { flags: gate.reasons }),
  } satisfies CampaignVariant;
}

/**
 * The `optimizer` pipeline node's run (trigger `cron`): optimises every running or paused campaign in
 * the workspace. Returns a one-line summary so the live agent graph flashes the node with its outcome.
 */
export async function runOptimizer(ctx: NodeContext): Promise<NodeResult> {
  const { workspaceId } = ctx;
  const campaigns = await Campaigns.find(workspaceId, { status: { $in: ['running', 'paused'] } });
  if (!campaigns.length) return { summary: 'No active campaigns' };

  let challengers = 0;
  let retired = 0;
  await reportProgress(0, campaigns.length);
  for (const [i, c] of campaigns.entries()) {
    const res = await optimizeCampaign(workspaceId, c._id).catch(() => null);
    if (res) {
      challengers += res.challengers;
      retired += res.retired;
    }
    await reportProgress(i + 1, campaigns.length);
  }
  return {
    summary: `${challengers} challenger${challengers === 1 ? '' : 's'}, ${retired} retired`,
  };
}

defineJob(OPTIMIZER_JOB, async (payload: JobPayload) => {
  const { workspaceId, campaignId } = payload as { workspaceId: Id; campaignId?: Id };
  if (campaignId) await optimizeCampaign(workspaceId, campaignId);
  else await runOptimizer({ workspaceId, runId: '', nodeId: OPTIMIZER_JOB });
});

export { MIN_CONFIDENT_SENDS };
