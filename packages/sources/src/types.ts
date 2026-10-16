import type {
  BusinessProfile,
  Icp,
  Id,
  LeadDraft,
  Source,
  SourceCost,
  SourceQuery,
} from '@sutra/domain';
import type {
  ApolloClient,
  CompanySearch,
  CsvInput,
  HunterClient,
  PlacesClient,
  RegistryClient,
} from './clients.ts';

/** Caps one prospecting run so it stays inside free-tier quotas. */
export interface SourceBudget {
  /** Max queries a single source may run. */
  maxQueries: number;
  /** Max drafts a single source may contribute. */
  maxResults: number;
}

/** The injected clients a source calls out through. */
export interface SourceClients {
  search: CompanySearch;
  places: PlacesClient;
  registry: RegistryClient;
  apollo: ApolloClient;
  hunter: HunterClient;
}

/** Everything a source needs to decide if it runs and to fetch: flags, keys, clients, budget. */
export interface SourceContext {
  workspaceId: Id;
  /** The `FEATURE_PAID_SOURCES` flag. */
  paidSourcesEnabled: boolean;
  /** Sources the workspace has turned on (PR 06 `settings.enabledSources`). */
  enabledSources: readonly Source[];
  /** Per-workspace API keys for the optional paid sources (decrypted). */
  keys: { apollo?: string; hunter?: string };
  budget: SourceBudget;
  clients: SourceClients;
  /** A pending CSV upload, when the `csv` source should run. */
  csv?: CsvInput;
  /** The confirmed ICP, so paid sources can build structured filters at fetch time. */
  icp?: Icp;
}

/**
 * One lead source: it decides whether it may run, plans concrete queries from the ICP, and streams
 * company/contact drafts. Every source is also a prospector sub-agent node in the agent graph.
 */
export interface LeadSource {
  id: Source;
  label: string;
  cost: SourceCost;
  enabled(ctx: SourceContext): boolean;
  plan(icp: Icp, profile: BusinessProfile): SourceQuery[];
  fetch(ctx: SourceContext, query: SourceQuery): AsyncIterable<LeadDraft>;
}
