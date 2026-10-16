import type { Campaign, CampaignVariant, Enrollment, Message, StopReason } from '@sutra/domain';
import { type ArmStats, chooseVariant, type Rng } from '../optimizer/bandit.ts';

/**
 * What the engine decides to do for one enrollment, right now. The `campaign.step` job turns
 * this into side effects (send, reschedule, stop); the decision itself is pure, so it is fully
 * unit-testable with a fake clock and no I/O.
 */
export type Action =
  | { type: 'stop'; reason: StopReason }
  | { type: 'wait'; until: Date }
  | { type: 'send'; stepIndex: number }
  | { type: 'skip'; stepIndex: number; reason: string };

/** A variant may be sent only once a person has approved its exact content (PR 10/12). */
const sendable = (v: CampaignVariant): boolean =>
  (v.status === 'approved' || v.status === 'active') && !!v.approvedHash;

/** Approved, active variants of a step — the only ones the engine will ever assign. */
export const sendableVariants = (step: Campaign['steps'][number]): CampaignVariant[] =>
  step.variants.filter(sendable);

/**
 * The deterministic campaign state machine. Given an enrollment, its campaign, the thread so far
 * and the current time, decides the single next action:
 *
 * - `stop`   — a reply, meeting, opt-out or bounce arrived, or the sequence is finished.
 * - `wait`   — the next step is scheduled for later (`enrollment.nextRunAt`).
 * - `skip`   — this step has no approved variant to send (e.g. an edit voided its approval).
 * - `send`   — send this step now.
 *
 * Pure: no database, no clock, no randomness. The caller handles pausing (a paused campaign or
 * enrollment never reaches here) and the effects of each action.
 */
export function nextAction(
  enr: Enrollment,
  campaign: Campaign,
  thread: Message[],
  now: Date,
): Action {
  // A terminal enrollment keeps its recorded reason.
  if (enr.status === 'stopped' || enr.status === 'completed')
    return { type: 'stop', reason: enr.stopReason ?? 'manual' };

  // Any inbound message in the thread stops every later step (reply, opt-out reply, etc.).
  if (thread.some((m) => m.direction === 'inbound')) return { type: 'stop', reason: 'replied' };
  // A bounced send stops the sequence: the address is dead.
  if (thread.some((m) => m.direction === 'outbound' && m.status === 'bounced'))
    return { type: 'stop', reason: 'bounced' };

  const step = campaign.steps[enr.stepIndex];
  if (!step) return { type: 'stop', reason: 'campaign_done' };

  // Scheduled for later: come back at `nextRunAt`.
  const due = enr.nextRunAt ?? now;
  if (due.getTime() > now.getTime()) return { type: 'wait', until: due };

  if (!sendableVariants(step).length)
    return { type: 'skip', stepIndex: enr.stepIndex, reason: 'no_approved_variant' };

  return { type: 'send', stepIndex: enr.stepIndex };
}

/** Per-variant stats the bandit needs: trials (`sends`) and rewards (`successes`) for the arm. */
export type VariantStatsLookup = (variantId: string) => { sends: number; successes: number };

/** No-stats lookup: every arm is a flat Beta(1, 1) prior, so assignment is effectively uniform. */
const NO_STATS: VariantStatsLookup = () => ({ sends: 0, successes: 0 });

/**
 * Picks a variant for a step from its approved, active variants using the Thompson-sampling bandit
 * (PR 15): each arm is a Beta posterior over its reward rate, with an exploration floor for arms that
 * don't yet have enough data. `stats` supplies each arm's sends and rewards (the campaign engine fills
 * it from the aggregated per-variant metrics); with no stats it falls back to a uniform prior. Retired
 * variants are already excluded (they're neither approved nor active). Returns `undefined` only when
 * the step has no sendable variant.
 */
export function pickVariant(
  step: Campaign['steps'][number],
  stats: VariantStatsLookup = NO_STATS,
  rng: Rng = Math.random,
): CampaignVariant | undefined {
  const options = sendableVariants(step);
  const first = options[0];
  if (!first) return undefined;
  if (options.length === 1) return first;
  const arms: ArmStats[] = options.map((v) => ({ id: v.id, ...stats(v.id) }));
  const chosen = chooseVariant(arms, rng);
  return options.find((v) => v.id === chosen) ?? first;
}
