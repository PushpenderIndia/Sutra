import { describe, expect, it } from 'vitest';
import { type ArmStats, chooseVariant, probabilityBest, type Rng, seededRng } from './bandit.ts';

type ArmId = 'a' | 'b';

/**
 * Simulates a campaign where variant B truly converts twice as well as A, driving the bandit purely
 * through {@link chooseVariant} and a Bernoulli "world". Returns the assignment stream and final stats.
 */
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

describe('bandit convergence simulator', () => {
  it('shifts traffic above 70% to the arm that truly converts 2x better within 300 sends', () => {
    const trueRate: Record<ArmId, number> = { a: 0.1, b: 0.2 };
    const { assignments, stats } = simulate({
      trueRate,
      sends: 300,
      bandit: seededRng(2026),
      world: seededRng(7),
    });

    // The acceptance criterion: by 300 sends the live traffic has converged on B.
    const window = assignments.slice(-100);
    const shareB = window.filter((x) => x === 'b').length / window.length;
    expect(shareB).toBeGreaterThan(0.7);
    expect(stats.b.sends).toBeGreaterThan(stats.a.sends);

    // And the posterior is confident B is best.
    const p = probabilityBest(
      [
        { id: 'a', ...stats.a },
        { id: 'b', ...stats.b },
      ],
      4000,
      seededRng(1),
    );
    expect(p.b ?? 0).toBeGreaterThan(0.8);
  });

  it('converges for several seeds (not a lucky single run)', () => {
    const trueRate: Record<ArmId, number> = { a: 0.08, b: 0.16 };
    for (const seed of [1, 42, 777, 2048]) {
      const { assignments } = simulate({
        trueRate,
        sends: 300,
        bandit: seededRng(seed),
        world: seededRng(seed * 31 + 1),
      });
      const window = assignments.slice(-100);
      const shareB = window.filter((x) => x === 'b').length / window.length;
      expect(shareB).toBeGreaterThan(0.7);
    }
  });
});
