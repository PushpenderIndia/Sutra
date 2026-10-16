import type { CompanySize, Country } from '@sutra/domain';

/**
 * Every source reaches the outside world through one of these narrow interfaces. Each has a
 * fixture-backed fake used in tests and demo mode; the real implementations live in
 * `@sutra/agents` (where config and the database are available).
 */

/** A company as a grounded search or a paid provider returned it. */
export interface CompanyHit {
  name: string;
  website?: string;
  domain?: string;
  country?: Country;
  city?: string;
  industry?: string;
  size?: CompanySize;
  description?: string;
  sourceUrl?: string;
}

/** Gemini + Google Search grounding, shared by the `search` and `lookalike` sources. */
export interface CompanySearch {
  find(query: string, opts: { limit: number }): Promise<CompanyHit[]>;
}

export interface PlaceResult {
  name: string;
  website?: string;
  city?: string;
  country?: Country;
  address?: string;
  placeId: string;
}

/** Google Places Text Search (new), behind the PR 02 monthly quota guard. */
export interface PlacesClient {
  textSearch(query: string, opts: { limit: number }): Promise<PlaceResult[]>;
}

/** An open company registry adapter (one per country; Singapore first). */
export interface RegistryClient {
  /** Countries this adapter can serve. */
  countries: readonly Country[];
  search(query: string, opts: { country: Country; limit: number }): Promise<CompanyHit[]>;
}

export interface ApolloPerson {
  name?: string;
  title?: string;
  email?: string;
  company: CompanyHit;
}

/** Apollo people/company search (optional, paid; workspace API key). */
export interface ApolloClient {
  search(
    filters: { industries: string[]; countries: Country[]; titles: string[]; sizes: CompanySize[] },
    opts: { limit: number },
  ): Promise<ApolloPerson[]>;
}

export interface HunterContact {
  name?: string;
  title?: string;
  email: string;
  confidence?: number;
}

/** Hunter domain search / email finder (optional, paid; workspace API key). */
export interface HunterClient {
  domainSearch(domain: string, opts: { limit: number }): Promise<HunterContact[]>;
}

/** A parsed CSV upload with an (AI- or heuristic-) guessed column mapping. */
export interface CsvInput {
  rows: Record<string, string>[];
  mapping: CsvMapping;
}

/** Which CSV column feeds which field; unknown fields are left unmapped. */
export interface CsvMapping {
  name?: string;
  website?: string;
  domain?: string;
  country?: string;
  city?: string;
  industry?: string;
  contactName?: string;
  title?: string;
  email?: string;
}

// ---------------------------------------------------------------------------
// Fakes (tests, demo mode). All deterministic.
// ---------------------------------------------------------------------------

const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** The terms (country code, industry, name words) a {@link CompanyHit} should match a query on. */
export function hitKeywords(hit: CompanyHit): string[] {
  return [
    ...(hit.country ? [hit.country.toLowerCase()] : []),
    ...tokens(hit.industry ?? ''),
    ...tokens(hit.name),
    ...tokens(hit.city ?? ''),
  ];
}

/**
 * A {@link CompanySearch} over a fixed pool. A company matches a query when the query mentions its
 * country (if it has one) and shares at least one industry or name keyword — so an industry search
 * and a name-based "companies like X" lookalike can return the same company, which lets tests
 * exercise cross-source dedupe.
 */
export function fakeCompanySearch(pool: readonly CompanyHit[]): CompanySearch {
  return {
    find: async (query, { limit }) => {
      const q = new Set(tokens(query));
      const matched = pool.filter((hit) => {
        const countryOk = !hit.country || q.has(hit.country.toLowerCase());
        const keywordOk = [...tokens(hit.industry ?? ''), ...tokens(hit.name)].some((w) =>
          q.has(w),
        );
        return countryOk && keywordOk;
      });
      return matched
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, limit);
    },
  };
}

export function fakePlacesClient(pool: readonly PlaceResult[]): PlacesClient {
  return {
    textSearch: async (query, { limit }) => {
      const q = new Set(tokens(query));
      return pool.filter((p) => !p.country || q.has(p.country.toLowerCase())).slice(0, limit);
    },
  };
}

export function fakeRegistryClient(
  byCountry: Partial<Record<Country, CompanyHit[]>>,
): RegistryClient {
  return {
    countries: Object.keys(byCountry) as Country[],
    search: async (query, { country, limit }) => {
      const q = new Set(tokens(query));
      return (byCountry[country] ?? [])
        .filter((hit) => tokens(hit.industry ?? '').some((w) => q.has(w)) || q.size === 0)
        .slice(0, limit);
    },
  };
}

export function fakeApolloClient(people: readonly ApolloPerson[]): ApolloClient {
  return { search: async (_filters, { limit }) => people.slice(0, limit) };
}

export function fakeHunterClient(byDomain: Record<string, HunterContact[]>): HunterClient {
  return { domainSearch: async (domain, { limit }) => (byDomain[domain] ?? []).slice(0, limit) };
}
