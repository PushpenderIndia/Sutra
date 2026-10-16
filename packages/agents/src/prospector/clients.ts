import { resolveMx } from 'node:dns/promises';
import { GoogleGenAI } from '@google/genai';
import { env } from '@sutra/config';
import { newId, PlacesUsage } from '@sutra/db';
import type { Country, Id } from '@sutra/domain';
import { companySize, country as countrySchema } from '@sutra/domain';
import type {
  ApolloClient,
  ApolloPerson,
  CompanyHit,
  CompanySearch,
  EmailVerifier,
  HunterClient,
  HunterContact,
  PlaceResult,
  PlacesClient,
  RegistryClient,
} from '@sutra/sources';
import { z } from 'zod';

const asCountry = (raw: unknown): Country | undefined => {
  const parsed = countrySchema.safeParse(typeof raw === 'string' ? raw.toUpperCase() : raw);
  return parsed.success ? parsed.data : undefined;
};

/** The structured shape we ask Gemini to return per company (kept lenient; parsed defensively). */
const searchCompany = z.object({
  name: z.string().min(1),
  website: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  industry: z.string().optional(),
  size: z.string().optional(),
  description: z.string().optional(),
  sourceUrl: z.string().optional(),
});

const toHit = (raw: z.infer<typeof searchCompany>): CompanyHit => ({
  name: raw.name,
  website: raw.website,
  country: asCountry(raw.country),
  city: raw.city,
  industry: raw.industry,
  size: companySize.safeParse(raw.size).data,
  description: raw.description,
  sourceUrl: z.url().safeParse(raw.sourceUrl).data,
});

const extractJsonArray = (text: string): unknown[] => {
  const body = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const value: unknown = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

/**
 * Gemini + Google Search grounding for the `search` and `lookalike` sources: asks the model for a
 * JSON array of real companies with source URLs. Best-effort — a failed call yields no companies
 * rather than failing the whole prospector.
 */
export class GeminiCompanySearch implements CompanySearch {
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(options: { apiKey?: string; model?: string } = {}) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey ?? env.GEMINI_API_KEY });
    this.model = options.model ?? 'gemini-2.5-flash';
  }

  async find(query: string, { limit }: { limit: number }): Promise<CompanyHit[]> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents:
          `Using Google Search, find up to ${limit} real companies matching: "${query}". ` +
          'Reply with ONLY a JSON array; each item: {name, website, country (ISO-3166 alpha-2), ' +
          'city, industry, size (one of 1-10, 11-50, 51-200, 201-1000, 1000+), description, ' +
          'sourceUrl}. Omit fields you cannot verify. Do not invent companies.',
        config: { tools: [{ googleSearch: {} }], temperature: 0.2 },
      });
      const text = response.text ?? '';
      return extractJsonArray(text)
        .map((raw) => searchCompany.safeParse(raw).data)
        .filter((v): v is z.infer<typeof searchCompany> => Boolean(v))
        .map(toHit)
        .slice(0, limit);
    } catch {
      return [];
    }
  }
}

/** Reserves `n` Places requests this month for a workspace, honouring the free-tier cap. */
export async function reservePlacesQuota(workspaceId: Id, n: number): Promise<number> {
  const month = new Date().toISOString().slice(0, 7);
  const cap = env.PLACES_MONTHLY_LIMIT;
  const current = (await PlacesUsage.findOne(workspaceId, { month }))?.requests ?? 0;
  const granted = Math.max(0, Math.min(n, cap - current));
  if (granted > 0)
    await PlacesUsage.col().updateOne(
      { workspaceId, month },
      { $inc: { requests: granted }, $setOnInsert: { _id: newId() } },
      { upsert: true },
    );
  return granted;
}

/**
 * Google Places Text Search (new) behind the monthly quota guard (PR 02). Each text search is one
 * request; when the cap is reached it returns nothing rather than spending beyond the free tier.
 */
export class GooglePlacesClient implements PlacesClient {
  constructor(
    private readonly workspaceId: Id,
    private readonly apiKey = env.GOOGLE_MAPS_API_KEY,
    private readonly reserve = reservePlacesQuota,
  ) {}

  async textSearch(query: string, { limit }: { limit: number }): Promise<PlaceResult[]> {
    if ((await this.reserve(this.workspaceId, 1)) < 1) return [];
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask':
            'places.displayName,places.websiteUri,places.formattedAddress,places.id,places.addressComponents',
        },
        body: JSON.stringify({ textQuery: query, pageSize: Math.min(limit, 20) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { places?: PlaceApi[] };
      return (data.places ?? []).slice(0, limit).map(fromPlace);
    } catch {
      return [];
    }
  }
}

type PlaceApi = {
  id: string;
  displayName?: { text?: string };
  websiteUri?: string;
  formattedAddress?: string;
  addressComponents?: { types?: string[]; shortText?: string; longText?: string }[];
};

const fromPlace = (place: PlaceApi): PlaceResult => {
  const components = place.addressComponents ?? [];
  const city = components.find((c) => c.types?.includes('locality'))?.longText;
  const countryCode = components.find((c) => c.types?.includes('country'))?.shortText;
  return {
    name: place.displayName?.text ?? 'Unknown',
    website: place.websiteUri,
    city,
    country: asCountry(countryCode),
    address: place.formattedAddress,
    placeId: place.id,
  };
};

/** Singapore's open company data on data.gov.sg (CKAN datastore). Best-effort; licence verified. */
export class DataGovSgRegistry implements RegistryClient {
  readonly countries: readonly Country[] = ['SG'];

  constructor(private readonly resourceId = env.REGISTRY_SG_RESOURCE_ID) {}

  async search(
    query: string,
    { country, limit }: { country: Country; limit: number },
  ): Promise<CompanyHit[]> {
    if (country !== 'SG' || !this.resourceId) return [];
    try {
      const url = new URL('https://data.gov.sg/api/action/datastore_search');
      url.searchParams.set('resource_id', this.resourceId);
      url.searchParams.set('q', query);
      url.searchParams.set('limit', String(limit));
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return [];
      const data = (await res.json()) as { result?: { records?: Record<string, string>[] } };
      return (data.result?.records ?? [])
        .map((record) => record.entity_name ?? record.company_name ?? record.name)
        .filter((name): name is string => Boolean(name))
        .slice(0, limit)
        .map((name) => ({ name, country, sourceUrl: 'https://data.gov.sg' }));
    } catch {
      return [];
    }
  }
}

/** Apollo people/company search (optional, paid). Thin REST wrapper around the workspace's key. */
export class ApolloRestClient implements ApolloClient {
  constructor(private readonly apiKey: string) {}

  async search(
    filters: { industries: string[]; countries: Country[]; titles: string[] },
    { limit }: { limit: number },
  ): Promise<ApolloPerson[]> {
    try {
      const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Api-Key': this.apiKey },
        body: JSON.stringify({
          person_titles: filters.titles,
          q_organization_keyword_tags: filters.industries,
          person_locations: filters.countries,
          per_page: Math.min(limit, 25),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { people?: ApolloApiPerson[] };
      return (data.people ?? []).slice(0, limit).map(fromApollo);
    } catch {
      return [];
    }
  }
}

type ApolloApiPerson = {
  name?: string;
  title?: string;
  email?: string;
  organization?: { name?: string; website_url?: string; primary_domain?: string };
};

const fromApollo = (person: ApolloApiPerson): ApolloPerson => ({
  name: person.name,
  title: person.title,
  email: person.email,
  company: {
    name: person.organization?.name ?? 'Unknown',
    website: person.organization?.website_url,
    domain: person.organization?.primary_domain,
  },
});

/** Hunter domain search / email finder (optional, paid). */
export class HunterRestClient implements HunterClient {
  constructor(private readonly apiKey: string) {}

  async domainSearch(domain: string, { limit }: { limit: number }): Promise<HunterContact[]> {
    try {
      const url = new URL('https://api.hunter.io/v2/domain-search');
      url.searchParams.set('domain', domain);
      url.searchParams.set('limit', String(Math.min(limit, 100)));
      url.searchParams.set('api_key', this.apiKey);
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return [];
      const data = (await res.json()) as {
        data?: {
          emails?: {
            value?: string;
            first_name?: string;
            last_name?: string;
            position?: string;
            confidence?: number;
          }[];
        };
      };
      return (data.data?.emails ?? [])
        .filter((e): e is { value: string } & typeof e => Boolean(e.value))
        .slice(0, limit)
        .map((e) => ({
          name: [e.first_name, e.last_name].filter(Boolean).join(' ') || undefined,
          title: e.position,
          email: e.value,
          confidence: e.confidence,
        }));
    } catch {
      return [];
    }
  }
}

/**
 * Checks a domain's MX records (no SMTP probing). Used only to decide whether a pattern-guessed
 * address is worth keeping. Failures count as "no MX", so a guess is dropped rather than kept blind.
 */
export const dnsEmailVerifier: EmailVerifier = {
  hasMx: async (domain) => {
    try {
      return (await resolveMx(domain)).length > 0;
    } catch {
      return false;
    }
  },
};
