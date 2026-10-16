import { z } from 'zod';
import { count, doc, id, locale, userId } from './common.ts';
import { campaignStatus, enrollmentStatus, variantStatus } from './status.ts';

export * from './merge.ts';

export const stepIntent = z.enum([
  'intro',
  'value',
  'social_proof',
  'case_study',
  'objection',
  'breakup',
]);

/** Sequence planner output (PR 12). */
export const sequencePlan = z.object({
  steps: z
    .array(
      z.object({
        delayDays: z.int().min(0).max(14),
        intent: stepIntent,
        angle: z.string().max(160),
      }),
    )
    .min(2)
    .max(5),
  rationale: z.string().max(400),
});
export type SequencePlan = z.infer<typeof sequencePlan>;

export const variantDimension = z.enum(['subject', 'hook', 'cta', 'length', 'tone']);
export type VariantDimension = z.infer<typeof variantDimension>;

/** Variant writer output (PR 12): a template that differs from its sibling in one dimension. */
export const variant = z.object({
  hypothesis: z.string().max(160),
  dimension: variantDimension,
  subject: z.string().max(80),
  body: z.string(),
});
export type Variant = z.infer<typeof variant>;

/** Variant writer output (PR 12): the two A/B templates for one step. */
export const variantPair = z.object({ variants: z.array(variant).length(2) });
export type VariantPair = z.infer<typeof variantPair>;

/** Translator output (PR 12): one locale's rendering of a variant template, merge fields intact. */
export const variantTranslation = z.object({
  subject: z.string().max(80),
  body: z.string(),
});
export type VariantTranslation = z.infer<typeof variantTranslation>;

/** A variant as stored on a campaign step, with its approval state. */
export const campaignVariant = variant.extend({
  id,
  status: variantStatus,
  origin: z.enum(['initial', 'optimizer']),
  parentId: id.optional(),
  translations: z
    .partialRecord(locale, z.object({ subject: z.string().max(80), body: z.string() }))
    .optional(),
  /** Quality-gate findings the reviewer should see; empty/absent means the gate passed cleanly. */
  flags: z.array(z.string()).optional(),
  /** Hash of the approved content; a send whose content hash differs is refused. */
  approvedHash: z.string().optional(),
  approvedBy: userId.optional(),
  approvedAt: z.date().optional(),
});
export type CampaignVariant = z.infer<typeof campaignVariant>;

export const campaignStep = z.object({
  delayDays: z.int().min(0).max(14),
  intent: stepIntent.optional(),
  angle: z.string().max(160).optional(),
  variants: z.array(campaignVariant),
});
export type CampaignStep = z.infer<typeof campaignStep>;

/** What the bandit optimises (PR 15). Opens are never a reward: they're unreliable. */
export const reward = z.enum(['positive_reply', 'reply', 'click']);
export type Reward = z.infer<typeof reward>;

/**
 * Per-variant metrics (PR 15), aggregated from `messages`, `tracking_events` and `replies`.
 * `sent` is the number of real sends (the bandit's trial count); `opens` are human opens only and
 * are approximate (privacy proxies), so they are display-only and never a reward.
 */
export const variantMetrics = z.object({
  sent: count,
  delivered: count,
  opens: count,
  clicks: count,
  replies: count,
  positiveReplies: count,
  unsubscribes: count,
  bounces: count,
});
export type VariantMetrics = z.infer<typeof variantMetrics>;

export const EMPTY_METRICS: VariantMetrics = {
  sent: 0,
  delivered: 0,
  opens: 0,
  clicks: 0,
  replies: 0,
  positiveReplies: 0,
  unsubscribes: 0,
  bounces: 0,
};

/** The reward count for a campaign's chosen metric — the bandit's "successes" for an arm. */
export function rewardSuccesses(metrics: VariantMetrics, r: Reward): number {
  if (r === 'click') return metrics.clicks;
  if (r === 'reply') return metrics.replies;
  return metrics.positiveReplies;
}

/**
 * One optimizer insight shown on the Campaigns tab. `text` always cites the numbers it is based on
 * (acceptance criterion); `stepIndex` points at the step it is about when it is step-specific.
 */
export const optimizerInsight = z.object({
  text: z.string().max(280),
  stepIndex: count.optional(),
  at: z.date(),
});
export type OptimizerInsight = z.infer<typeof optimizerInsight>;

/** A challenger the optimizer proposes for a step: a new variant that changes one dimension. */
export const challengerProposal = variant;
export type ChallengerProposal = z.infer<typeof challengerProposal>;

export const campaign = doc({
  name: z.string().min(1),
  icpVersion: count.min(1),
  /** Title of the ICP persona this sequence targets (one campaign per persona). */
  persona: z.string().optional(),
  steps: z.array(campaignStep),
  reward: reward.default('positive_reply'),
  status: campaignStatus.default('draft'),
  approvedBy: userId.optional(),
  approvedAt: z.date().optional(),
  approvedHash: z.string().optional(),
  /** Latest optimizer insights (PR 15), most recent first; each cites the numbers behind it. */
  insights: z.array(optimizerInsight).optional(),
});
export type Campaign = z.infer<typeof campaign>;

/**
 * The per-contact personalisation line (PR 12). `sutra-fast` writes it at send time from the
 * contact's company research and must cite a `sourceUrl` that appears in that research, so the
 * `{{personalization}}` slot is grounded. The template around it stays fixed per variant.
 */
export const personalizationLine = z.object({
  line: z.string().min(1).max(400),
  sourceUrl: z.url(),
});
export type PersonalizationLine = z.infer<typeof personalizationLine>;

/** A personalisation line cached per contact and step, so a retried send reuses the same text. */
export const personalization = doc({
  contactId: id,
  campaignId: id,
  stepIndex: count,
  locale,
  ...personalizationLine.shape,
});
export type Personalization = z.infer<typeof personalization>;

export const stopReason = z.enum([
  'replied',
  'meeting_booked',
  'opted_out',
  'bounced',
  'campaign_done',
  'manual',
]);
export type StopReason = z.infer<typeof stopReason>;

export const enrollment = doc({
  contactId: id,
  campaignId: id,
  stepIndex: count,
  status: enrollmentStatus.default('active'),
  nextRunAt: z.date().optional(),
  /** Step index (as a string key) → the variant assigned for that step. */
  assignedVariants: z.record(z.string().regex(/^\d+$/), id).default({}),
  stopReason: stopReason.optional(),
});
export type Enrollment = z.infer<typeof enrollment>;
