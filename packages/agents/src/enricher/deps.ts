import { env } from '@sutra/config';
import { scorer } from '../agents/scorer.ts';
import { enricherFixtures } from './fixtures.ts';
import {
  type CompanyResearcher,
  fakeCompanyResearcher,
  GeminiCompanyResearcher,
} from './researcher.ts';
import { DEFAULT_SCORE_WEIGHTS, type ScoreWeights } from './scoring.ts';

/**
 * The enricher's external tools and LLM agents, behind one seam (mirrors the profiler/prospector).
 * Real implementations by default; fakes seeded with fixtures in tests and demo mode. Contact
 * discovery reuses the prospector's own deps. Tests may swap any of these with {@link setEnricherDeps}.
 */
export interface EnricherDeps {
  researcher: CompanyResearcher;
  scorer: typeof scorer;
  weights: ScoreWeights;
}

let override: Partial<EnricherDeps> = {};

/** Overrides some or all enricher dependencies (tests, demo seeding). Pass `{}` to reset. */
export const setEnricherDeps = (deps: Partial<EnricherDeps>) => {
  override = deps;
};

function defaults(demo: boolean): EnricherDeps {
  const fake = env.NODE_ENV === 'test' || demo;
  return {
    researcher: fake ? fakeCompanyResearcher(enricherFixtures) : new GeminiCompanyResearcher(),
    scorer,
    weights: DEFAULT_SCORE_WEIGHTS,
  };
}

/** Enricher dependencies for a workspace. `demo` selects fixture-backed fakes over real clients. */
export const enricherDeps = (demo: boolean): EnricherDeps => ({ ...defaults(demo), ...override });
