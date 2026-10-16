import { describe, expect, it } from 'vitest';
import {
  type ArmStats,
  chooseVariant,
  evaluateArms,
  probabilityBest,
  seededRng,
  wilsonInterval,
} from './bandit.ts';

const arm = (id: string, sends: number, successes: number, retired = false): ArmStats => ({
  id,
  sends,
  successes,
  ...(retired && { retired }),
});

describe('seededRng', () => {
  it('is deterministic for a given seed and differs across seeds', () => {
    const a = seededRng(123);
    const b = seededRng(123);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
    const c = Array.from({ length: 5 }, seededRng(124));
    expect(c).not.toEqual(seqA);
  });
});

describe('chooseVariant', () => {
  it('is deterministic given a seeded rng', () => {
    const arms = [arm('a', 50, 20), arm('b', 50, 5)];
    expect(chooseVariant(arms, seededRng(9))).toBe(chooseVariant(arms, seededRng(9)));
  });

  it('returns undefined with no active arms and the sole arm when there is one', () => {
    expect(chooseVariant([], seededRng(1))).toBeUndefined();
    expect(chooseVariant([arm('a', 0, 0, true)], seededRng(1))).toBeUndefined();
    expect(chooseVariant([arm('solo', 10, 3)], seededRng(1))).toBe('solo');
  });

  it('never assigns a retired arm', () => {
    const arms = [arm('live', 10, 1), arm('dead', 200, 199, true)];
    const rng = seededRng(3);
    for (let i = 0; i < 300; i++) expect(chooseVariant(arms, rng)).toBe('live');
  });

  it('honours the exploration floor: an under-explored arm still gets ~10% of traffic', () => {
    // A looks near-perfect but is still under 30 sends, so B must not be starved.
    const arms = [arm('a', 29, 29), arm('b', 0, 0)];
    const rng = seededRng(5);
    let picksB = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (chooseVariant(arms, rng) === 'b') picksB++;
    const shareB = picksB / n;
    expect(shareB).toBeGreaterThan(0.05);
    expect(shareB).toBeLessThan(0.2);
  });
});

describe('probabilityBest', () => {
  it('concentrates on the clearly better arm and sums to 1 across active arms', () => {
    const arms = [arm('a', 100, 40), arm('b', 100, 10)];
    const p = probabilityBest(arms, 4000, seededRng(11));
    expect(p.a ?? 0).toBeGreaterThan(0.95);
    expect((p.a ?? 0) + (p.b ?? 0)).toBeCloseTo(1, 5);
  });

  it('reports 0 for retired arms and 1 for a single active arm', () => {
    const p = probabilityBest([arm('a', 50, 25), arm('dead', 50, 0, true)], 2000, seededRng(1));
    expect(p.dead ?? 0).toBe(0);
    expect(p.a ?? 0).toBe(1);
  });
});

describe('evaluateArms', () => {
  it('flags a loser for retirement once it has enough sends', () => {
    const [strong, weak] = evaluateArms([arm('s', 60, 30), arm('w', 60, 0)], 3000, seededRng(2));
    expect(weak?.retire).toBe(true);
    expect(strong?.retire).toBe(false);
  });

  it('does not retire before 50 sends even when losing', () => {
    const evals = evaluateArms([arm('s', 20, 10), arm('w', 20, 0)], 3000, seededRng(2));
    expect(evals.every((e) => e.retire === false)).toBe(true);
    expect(evals.every((e) => e.enoughData === false)).toBe(true); // < 30 sends → not enough data
  });

  it('declares a winner at P(best) > 95% with at least 100 sends', () => {
    const [strong, weak] = evaluateArms([arm('s', 140, 70), arm('w', 140, 2)], 4000, seededRng(4));
    expect(strong?.winner).toBe(true);
    expect(weak?.winner).toBe(false);
  });
});

describe('wilsonInterval', () => {
  it('brackets the observed rate and is empty with no trials', () => {
    const band = wilsonInterval(20, 100);
    expect(band.rate).toBeCloseTo(0.2, 5);
    expect(band.low).toBeLessThan(band.rate);
    expect(band.high).toBeGreaterThan(band.rate);
    expect(band.low).toBeGreaterThanOrEqual(0);
    expect(band.high).toBeLessThanOrEqual(1);
    expect(wilsonInterval(0, 0)).toEqual({ rate: 0, low: 0, high: 0 });
  });
});
