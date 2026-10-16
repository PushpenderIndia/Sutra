import { challengerWriter } from '../agents/optimizer.ts';

/**
 * The optimizer's LLM agents behind one seam (mirrors the copywriter / reply analyst). The real
 * `sutra-smart` challenger writer by default; tests swap it for an agent pointed at the mock LLM
 * proxy with {@link setOptimizerDeps}. All language goes through this seam — the bandit, the
 * stats, the retire/winner rules and the challenger selection stay deterministic in code.
 */
export interface OptimizerDeps {
  challengerWriter: typeof challengerWriter;
}

let override: Partial<OptimizerDeps> = {};

/** Overrides some or all optimizer dependencies (tests, demo seeding). Pass `{}` to reset. */
export const setOptimizerDeps = (deps: Partial<OptimizerDeps>) => {
  override = deps;
};

const defaults = (): OptimizerDeps => ({ challengerWriter });

export const optimizerDeps = (): OptimizerDeps => ({ ...defaults(), ...override });
