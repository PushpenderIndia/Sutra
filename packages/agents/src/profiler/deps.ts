import { env } from '@sutra/config';
import { icpBuilder, profileWriter } from '../agents/profiler.ts';
import { type Crawler, fakeCrawler, HttpCrawler } from './crawler.ts';
import { fixtureResearch, profilerFixtures } from './fixtures.ts';
import { fakeWebResearcher, GeminiWebResearcher, type WebResearcher } from './research.ts';

/**
 * The profiler's external tools and LLM agents, behind one seam. Real implementations by default;
 * fakes seeded with fixtures in tests and demo mode. Tests may swap any of them with
 * {@link setProfilerDeps}.
 */
export interface ProfilerDeps {
  crawler: Crawler;
  researcher: WebResearcher;
  profileWriter: typeof profileWriter;
  icpBuilder: typeof icpBuilder;
}

let override: Partial<ProfilerDeps> = {};

/** Overrides some or all profiler dependencies (tests, demo seeding). Pass `{}` to reset. */
export const setProfilerDeps = (deps: Partial<ProfilerDeps>) => {
  override = deps;
};

function defaults(demo: boolean): ProfilerDeps {
  const fake = env.NODE_ENV === 'test' || demo;
  return {
    crawler: fake ? fakeCrawler(profilerFixtures) : new HttpCrawler(),
    researcher: fake ? fakeWebResearcher(fixtureResearch) : new GeminiWebResearcher(),
    profileWriter,
    icpBuilder,
  };
}

/** Profiler dependencies for a workspace. `demo` selects fixture-backed fakes over real clients. */
export const profilerDeps = (demo: boolean): ProfilerDeps => ({ ...defaults(demo), ...override });
