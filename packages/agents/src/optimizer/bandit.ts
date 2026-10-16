/**
 * The Thompson-sampling multi-armed bandit that steers A/B traffic (PR 15). Pure, deterministic
 * TypeScript: every function takes an injectable `rng`, so the whole thing is unit-testable with a
 * seeded generator and no I/O. The campaign engine calls {@link chooseVariant} at assignment time;
 * the optimizer and the UI call {@link probabilityBest} and {@link evaluateArms} for the win
 * probabilities, the retire/winner rules and the confidence bands.
 *
 * Model: each arm is a Beta(1 + successes, 1 + failures) posterior over its reward rate. "Successes"
 * is the reward count for the campaign's chosen metric (positive reply by default); "sends" is the
 * number of real sends (trials). Opens are never a reward — they're unreliable (privacy proxies).
 */

export type VariantId = string;
export type Rng = () => number;

/** One arm of the bandit: a variant with its trial count and reward count. */
export interface ArmStats {
  id: VariantId;
  /** Real sends — the Beta posterior's trial count. */
  sends: number;
  /** Rewards (e.g. positive replies) for the campaign's metric; clamped to `[0, sends]`. */
  successes: number;
  /** A retired arm is never sampled and never assigned. */
  retired?: boolean;
}

// Exploration and lifecycle thresholds (spec §2).
/** Every under-explored active arm gets at least this share of traffic. */
export const EXPLORE_FLOOR = 0.1;
/** An arm is "under-explored" until it has this many sends. */
export const EXPLORE_MIN_SENDS = 30;
/** Retire an arm when P(best) < this… */
export const RETIRE_PBEST = 0.05;
/** …and it has at least this many sends (retiring only reduces what's sent, so it's automatic). */
export const RETIRE_MIN_SENDS = 50;
/** Declare a winner when P(best) > this… */
export const WINNER_PBEST = 0.95;
/** …with at least this many sends. Traffic converges naturally; the winner just gets a crown. */
export const WINNER_MIN_SENDS = 100;
/** Below this many sends per arm the UI shows "not enough data yet". */
export const MIN_CONFIDENT_SENDS = 30;
/** Monte-Carlo draws for {@link probabilityBest}. */
export const DEFAULT_DRAWS = 10_000;

/**
 * A fast, seedable PRNG (mulberry32). Deterministic for a given seed, so tests of the bandit and the
 * convergence simulator are reproducible.
 */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal sample via Box–Muller, from two uniforms. */
function standardNormal(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng(); // avoid log(0)
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * A Gamma(shape, 1) sample (Marsaglia–Tsang). `shape` is always ≥ 1 here (1 + a non-negative count),
 * so this branch suffices and runs in constant time regardless of the counts.
 */
function sampleGamma(shape: number, rng: Rng): number {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = standardNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** A Beta(alpha, beta) sample as the ratio of two Gamma samples. */
export function sampleBeta(alpha: number, beta: number, rng: Rng = Math.random): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

/** The Beta posterior parameters for an arm, with successes clamped to `[0, sends]`. */
function posterior(arm: ArmStats): { alpha: number; beta: number } {
  const successes = Math.max(0, Math.min(arm.successes, arm.sends));
  return { alpha: 1 + successes, beta: 1 + (arm.sends - successes) };
}

const activeArms = (arms: readonly ArmStats[]): ArmStats[] => arms.filter((a) => !a.retired);

/**
 * Chooses the variant to send next from the arms' current stats. Retired arms are never chosen. An
 * exploration floor guarantees every under-explored active arm at least {@link EXPLORE_FLOOR} of the
 * traffic until it reaches {@link EXPLORE_MIN_SENDS}; otherwise it is pure Thompson sampling (sample
 * each arm's Beta posterior, highest wins). Returns `undefined` only when there is no active arm.
 */
export function chooseVariant(
  arms: readonly ArmStats[],
  rng: Rng = Math.random,
): VariantId | undefined {
  const active = activeArms(arms);
  const first = active[0];
  if (!first) return undefined;
  if (active.length === 1) return first.id;

  // Exploration floor: reserve traffic for arms that don't yet have enough data to trust.
  const under = active.filter((a) => a.sends < EXPLORE_MIN_SENDS);
  const reserved = Math.min(1, under.length * EXPLORE_FLOOR);
  if (under.length && rng() < reserved) {
    const pick = under[Math.floor(rng() * under.length)] ?? under[0];
    return pick?.id ?? first.id;
  }

  let bestId = first.id;
  let bestDraw = -1;
  for (const arm of active) {
    const { alpha, beta } = posterior(arm);
    const draw = sampleBeta(alpha, beta, rng);
    if (draw > bestDraw) {
      bestDraw = draw;
      bestId = arm.id;
    }
  }
  return bestId;
}

/**
 * P(this arm is the best) for each arm, by Monte-Carlo over the Beta posteriors. Retired arms report
 * 0. A single active arm reports 1. The result sums to 1 across the active arms.
 */
export function probabilityBest(
  arms: readonly ArmStats[],
  draws = DEFAULT_DRAWS,
  rng: Rng = Math.random,
): Record<VariantId, number> {
  const result: Record<VariantId, number> = {};
  for (const a of arms) result[a.id] = 0;
  const active = activeArms(arms);
  const first = active[0];
  if (!first) return result;
  if (active.length === 1) {
    result[first.id] = 1;
    return result;
  }

  const posteriors = active.map((a) => ({ id: a.id, ...posterior(a) }));
  const wins = new Map<VariantId, number>();
  for (let d = 0; d < draws; d++) {
    let bestId = first.id;
    let bestVal = -1;
    for (const arm of posteriors) {
      const val = sampleBeta(arm.alpha, arm.beta, rng);
      if (val > bestVal) {
        bestVal = val;
        bestId = arm.id;
      }
    }
    wins.set(bestId, (wins.get(bestId) ?? 0) + 1);
  }
  for (const a of active) result[a.id] = (wins.get(a.id) ?? 0) / draws;
  return result;
}

/** A Wilson score confidence interval for a rate — the band shown on every rate in the UI. */
export interface RateBand {
  rate: number;
  low: number;
  high: number;
}
export function wilsonInterval(successes: number, trials: number, z = 1.96): RateBand {
  if (trials <= 0) return { rate: 0, low: 0, high: 0 };
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;
  return { rate: p, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/** Per-arm evaluation: win probability plus the retire / winner / enough-data verdicts. */
export interface ArmEvaluation {
  id: VariantId;
  sends: number;
  pBest: number;
  /** Auto-retire candidate: P(best) below the floor with enough sends, among ≥ 2 active arms. */
  retire: boolean;
  /** Declared winner: P(best) above the ceiling with enough sends. */
  winner: boolean;
  /** Whether the arm has enough sends for its rates to be trusted. */
  enoughData: boolean;
}

/**
 * Evaluates every arm: its P(best) and whether it should be retired or crowned. Retiring only ever
 * reduces what's sent, so it is automatic; declaring a winner is cosmetic (a crown) since traffic
 * converges on its own.
 */
export function evaluateArms(
  arms: readonly ArmStats[],
  draws = DEFAULT_DRAWS,
  rng: Rng = Math.random,
): ArmEvaluation[] {
  const pBest = probabilityBest(arms, draws, rng);
  const multiple = activeArms(arms).length > 1;
  return arms.map((a) => {
    const p = pBest[a.id] ?? 0;
    return {
      id: a.id,
      sends: a.sends,
      pBest: p,
      retire: !a.retired && multiple && a.sends >= RETIRE_MIN_SENDS && p < RETIRE_PBEST,
      winner: !a.retired && a.sends >= WINNER_MIN_SENDS && p > WINNER_PBEST,
      enoughData: a.sends >= MIN_CONFIDENT_SENDS,
    };
  });
}
