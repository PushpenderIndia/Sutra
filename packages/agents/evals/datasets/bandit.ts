import {
  type ArmStats,
  chooseVariant,
  probabilityBest,
  type Rng,
  seededRng,
} from '../../src/optimizer/bandit.ts';
import { type EvalReport, metric, ratio } from '../framework.ts';

type ArmId = 'a' | 'b';

/** Drives the Thompson-sampling bandit through a Bernoulli world where B converts better than A. */
function simulate(opts: {
  trueRate: Record<ArmId, number>;
  sends: number;
  bandit: Rng;
  world: Rng;
}) {
  const { trueRate, sends, bandit, world } = opts;
  const stats: Record<ArmId, { sends: number; successes: number }> = {
    a: { sends: 0, successes: 0 },
    b: { sends: 0, successes: 0 },
  };
  const assignments: ArmId[] = [];
  for (let i = 0; i < sends; i++) {
    const arms: ArmStats[] = [
      { id: 'a', ...stats.a },
      { id: 'b', ...stats.b },
    ];
    const chosen = (chooseVariant(arms, bandit) ?? 'a') as ArmId;
    assignments.push(chosen);
    stats[chosen].sends++;
    if (world() < trueRate[chosen]) stats[chosen].successes++;
  }
  return { assignments, stats };
}

const SENDS = 300;
const SEEDS = [1, 42, 777, 2048, 31337, 2026];

/**
 * Bandit convergence simulator (PR 15 acceptance criterion folded into the harness): with B truly
 * converting twice as well as A, at least 70% of the last 100 sends should go to B within 300 sends.
 * Measured as the fraction of independent seeds that converge (so it is not a lucky single run).
 */
export function evaluateBandit(): EvalReport {
  const trueRate: Record<ArmId, number> = { a: 0.1, b: 0.2 };
  const shares = SEEDS.map((seed) => {
    const { assignments } = simulate({
      trueRate,
      sends: SENDS,
      bandit: seededRng(seed),
      world: seededRng(seed * 31 + 1),
    });
    const window = assignments.slice(-100);
    return ratio(window.filter((x) => x === 'b').length, window.length);
  });
  const converged = shares.filter((s) => s >= 0.7).length;
  const convergenceRate = ratio(converged, SEEDS.length);
  const meanShare = ratio(
    shares.reduce((s, v) => s + v, 0),
    shares.length,
  );

  // A confidence check on the posterior from one representative run.
  const { stats } = simulate({
    trueRate,
    sends: SENDS,
    bandit: seededRng(2026),
    world: seededRng(7),
  });
  const p = probabilityBest(
    [
      { id: 'a', ...stats.a },
      { id: 'b', ...stats.b },
    ],
    4000,
    seededRng(1),
  );

  return {
    agent: 'bandit',
    description: `simulator: B converts 2× A; traffic share to B over ${SEEDS.length} seeds within ${SENDS} sends`,
    cases: SEEDS.length,
    metrics: [
      metric('mean traffic share to B', meanShare, 0.7, {
        note: `last 100 of ${SENDS} sends, mean of ${SEEDS.length} seeds`,
      }),
      metric('seeds converged ≥70%', convergenceRate, 0.7, {
        note: `${converged}/${SEEDS.length} seeds`,
      }),
      metric('posterior P(B best)', p.b ?? 0, 0.8),
    ],
  };
}
