import { decrypt, env } from '@sutra/config';
import { Credentials, WorkspaceSettings } from '@sutra/db';
import type { Id } from '@sutra/domain';
import {
  apolloPool,
  companyPool,
  DEFAULT_BUDGET,
  type EmailVerifier,
  fakeApolloClient,
  fakeCompanySearch,
  fakeEmailVerifier,
  fakeHunterClient,
  fakePlacesClient,
  fakeRegistryClient,
  hunterPool,
  placePool,
  registryPool,
  type SourceClients,
  type SourceContext,
} from '@sutra/sources';
import { contactExtractor } from '../agents/prospector.ts';
import { type Crawler, fakeCrawler, HttpCrawler } from '../profiler/crawler.ts';
import { profilerFixtures } from '../profiler/fixtures.ts';
import {
  ApolloRestClient,
  DataGovSgRegistry,
  dnsEmailVerifier,
  GeminiCompanySearch,
  GooglePlacesClient,
  HunterRestClient,
} from './clients.ts';

/**
 * The prospector's external tools behind one seam, mirroring the profiler. Real implementations by
 * default; fixture-backed fakes in tests and demo mode. Tests may swap any of them with
 * {@link setProspectorDeps}.
 */
export interface ProspectorDeps {
  /** The lead-source clients (search, places, registry, apollo, hunter). */
  clients: (workspaceId: Id, keys: { apollo?: string; hunter?: string }) => SourceClients;
  crawler: Crawler;
  emailVerifier: EmailVerifier;
  contactExtractor: typeof contactExtractor;
}

let override: Partial<ProspectorDeps> = {};

/** Overrides some or all prospector dependencies (tests, demo seeding). Pass `{}` to reset. */
export const setProspectorDeps = (deps: Partial<ProspectorDeps>) => {
  override = deps;
};

const fakeClients = (): SourceClients => ({
  // `topUp` pads thin matches so a live demo always shows a healthy set of prospects; disabled under
  // test so the prospector's strict dedupe/count assertions stay deterministic.
  search: fakeCompanySearch(companyPool, { topUp: env.NODE_ENV !== 'test' }),
  places: fakePlacesClient(placePool),
  registry: fakeRegistryClient(registryPool),
  apollo: fakeApolloClient(apolloPool),
  hunter: fakeHunterClient(hunterPool),
});

function defaults(demo: boolean): ProspectorDeps {
  const fake = env.NODE_ENV === 'test' || demo;
  return {
    clients: fake
      ? () => fakeClients()
      : (workspaceId, keys) => ({
          search: new GeminiCompanySearch(),
          places: new GooglePlacesClient(workspaceId),
          registry: new DataGovSgRegistry(),
          apollo: new ApolloRestClient(keys.apollo ?? ''),
          hunter: new HunterRestClient(keys.hunter ?? ''),
        }),
    crawler: fake ? fakeCrawler(profilerFixtures) : new HttpCrawler(),
    emailVerifier: fake ? fakeEmailVerifier() : dnsEmailVerifier,
    contactExtractor,
  };
}

/** Prospector dependencies for a workspace. `demo` selects fixture-backed fakes over real clients. */
export const prospectorDeps = (demo: boolean): ProspectorDeps => ({
  ...defaults(demo),
  ...override,
});

/** A workspace's decrypted Apollo/Hunter keys (per-workspace secrets; absent when not configured). */
export async function paidSourceKeys(
  workspaceId: Id,
): Promise<{ apollo?: string; hunter?: string }> {
  const creds = await Credentials.find(workspaceId, { provider: { $in: ['apollo', 'hunter'] } });
  const keys: { apollo?: string; hunter?: string } = {};
  for (const cred of creds) {
    if (cred.provider === 'apollo') keys.apollo = decrypt(cred.ciphertext);
    if (cred.provider === 'hunter') keys.hunter = decrypt(cred.ciphertext);
  }
  return keys;
}

/** Builds the {@link SourceContext} for a workspace: flags, toggles, keys, clients and budget. */
export async function buildSourceContext(
  workspaceId: Id,
  deps?: ProspectorDeps,
): Promise<SourceContext> {
  const settings = await WorkspaceSettings.findOne(workspaceId, {});
  const resolved = deps ?? prospectorDeps(settings?.demoMode ?? true);
  const keys = env.FEATURE_PAID_SOURCES ? await paidSourceKeys(workspaceId) : {};
  return {
    workspaceId,
    paidSourcesEnabled: env.FEATURE_PAID_SOURCES,
    enabledSources: settings?.enabledSources ?? [
      'search',
      'lookalike',
      'places',
      'registry',
      'csv',
    ],
    keys,
    budget: { ...DEFAULT_BUDGET },
    clients: resolved.clients(workspaceId, keys),
  };
}
