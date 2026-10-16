import type { BusinessProfile, Icp, LeadDraft } from '@sutra/domain';
import { describe, expect, it } from 'vitest';
import { emailPatterns, isRoleEmail, nameParts, resolveEmail, roleEmail } from './email.ts';
import {
  collectLeads,
  companyPool,
  DEFAULT_BUDGET,
  enabledLeadSources,
  fakeCompanySearch,
  fakeEmailVerifier,
  leadSources,
  type SourceContext,
} from './index.ts';
import { companyKey, countryFromDomain, domainFromWebsite, normalizeName } from './normalize.ts';
import { matchPersona } from './persona.ts';
import { guessMapping, parseCsv, rowToDrafts } from './sources/csv.ts';
import { isLocalBusinessIcp } from './sources/places.ts';

const ICP: Icp = {
  firmographics: {
    industries: ['Coffee chain', 'Bakery'],
    sizes: ['11-50', '51-200'],
    countries: ['SG', 'ID'],
    keywords: ['outlets'],
    technologies: [],
  },
  personas: [
    {
      title: 'Head of Operations',
      altTitles: ['Operations Lead', 'Ops Manager'],
      seniority: 'director',
      pains: [],
      goals: [],
      objections: [],
    },
  ],
  buyingSignals: ['opened a new outlet'],
  disqualifiers: [],
  rationale: 'Multi-outlet F&B.',
};

const PROFILE: BusinessProfile = {
  name: 'PixelPress',
  website: 'https://pixelpress.sg',
  oneLiner: 'Packaging for F&B brands.',
  offerings: [],
  proofPoints: [],
  customers: [
    { name: 'Kaya Toast Club', domain: 'kayatoastclub.example', sourceUrl: 'https://p.example' },
  ],
  geographies: ['SG'],
  differentiators: [],
  competitors: [{ name: 'Generic Print', domain: 'genericprint.example' }],
  toneOfVoice: 'Friendly.',
  sources: ['https://pixelpress.sg'],
};

const ctx = (over: Partial<SourceContext> = {}): SourceContext => ({
  workspaceId: '000000000000000000000001',
  paidSourcesEnabled: false,
  enabledSources: ['search', 'lookalike', 'places', 'registry', 'csv'],
  keys: {},
  budget: { ...DEFAULT_BUDGET },
  clients: {
    search: fakeCompanySearch(companyPool),
    places: { textSearch: async () => [] },
    registry: { countries: ['SG'], search: async () => [] },
    apollo: { search: async () => [] },
    hunter: { domainSearch: async () => [] },
  },
  icp: ICP,
  ...over,
});

const collect = async (drafts: AsyncIterable<LeadDraft>): Promise<LeadDraft[]> => {
  const out: LeadDraft[] = [];
  for await (const d of drafts) out.push(d);
  return out;
};

describe('normalise & dedupe', () => {
  it('normalises company names, dropping suffixes and punctuation', () => {
    expect(normalizeName('Acme Pte. Ltd.')).toBe('acme');
    expect(normalizeName('Kopi Nusantara')).toBe('kopi nusantara');
    expect(normalizeName('CafÉ Niño')).toBe('cafe nino');
  });

  it('extracts the domain from a website, stripping www', () => {
    expect(domainFromWebsite('https://www.Acme.com/about')).toBe('acme.com');
    expect(domainFromWebsite('acme.co.id')).toBe('acme.co.id');
    expect(domainFromWebsite('not a url')).toBeUndefined();
  });

  it('builds the dedupe key from domain, else name + country', () => {
    expect(companyKey({ domain: 'acme.com', normalizedName: 'acme', country: 'SG' })).toBe(
      'acme.com',
    );
    expect(companyKey({ normalizedName: 'acme', country: 'SG' })).toBe('acme|SG');
    expect(countryFromDomain('acme.co.id', 'US')).toBe('ID');
    expect(countryFromDomain('acme.com', 'SG')).toBe('SG');
  });
});

describe('email helpers', () => {
  it('generates common address patterns, best-known first', () => {
    expect(emailPatterns('Ayu Pratama', 'kopi.example')).toEqual([
      'ayu.pratama@kopi.example',
      'apratama@kopi.example',
      'ayu@kopi.example',
    ]);
    expect(emailPatterns('Madonna', 'x.example')).toEqual(['madonna@x.example']);
    expect(nameParts('Dr. Mei Lin')).toEqual({ first: 'mei', last: 'lin' });
  });

  it('detects role inboxes', () => {
    expect(isRoleEmail('info@x.example')).toBe(true);
    expect(isRoleEmail('ayu@x.example')).toBe(false);
  });

  it('resolves a published address as verified, a guess with MX as pattern', async () => {
    const verifier = fakeEmailVerifier(['kopi.example']);
    expect(
      await resolveEmail(
        { publishedEmail: 'Ayu@Kopi.Example', domain: 'kopi.example' },
        verifier.hasMx,
      ),
    ).toEqual({ email: 'ayu@kopi.example', confidence: 'verified' });
    expect(
      await resolveEmail(
        { publishedEmail: 'info@kopi.example', domain: 'kopi.example' },
        verifier.hasMx,
      ),
    ).toEqual({ email: 'info@kopi.example', confidence: 'role' });
    expect(
      await resolveEmail({ name: 'Ayu Pratama', domain: 'kopi.example' }, verifier.hasMx),
    ).toEqual({ email: 'ayu.pratama@kopi.example', confidence: 'pattern' });
    // No MX → a guess is dropped rather than kept blind.
    expect(
      await resolveEmail({ name: 'Ayu Pratama', domain: 'nope.example' }, verifier.hasMx),
    ).toBeUndefined();
    expect(roleEmail('kopi.example')).toBe('info@kopi.example');
  });
});

describe('persona match', () => {
  it('matches by exact title, alt title, then keyword overlap', () => {
    expect(matchPersona('Head of Operations', ICP.personas)).toBe('Head of Operations');
    expect(matchPersona('Ops Manager', ICP.personas)).toBe('Head of Operations');
    expect(matchPersona('Operations Director', ICP.personas)).toBe('Head of Operations');
    expect(matchPersona('Barista', ICP.personas)).toBeUndefined();
    expect(matchPersona(undefined, ICP.personas)).toBeUndefined();
  });
});

describe('query planners', () => {
  it('search pairs every country with every industry', () => {
    const queries = leadSources[0]?.plan(ICP, PROFILE) ?? [];
    expect(queries).toHaveLength(4);
    expect(queries[0]?.text).toContain('Coffee chain companies in SG');
    expect(queries[0]?.text).toContain('opened a new outlet');
  });

  it('lookalike plans one query per customer per country, recording who it resembles', () => {
    const queries = leadSources[1]?.plan(ICP, PROFILE) ?? [];
    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatchObject({ resembles: 'Kaya Toast Club', source: 'lookalike' });
  });

  it('places only plans for a local-business ICP', () => {
    expect(isLocalBusinessIcp(ICP)).toBe(true);
    const nonLocal: Icp = {
      ...ICP,
      firmographics: { ...ICP.firmographics, industries: ['Banking'], keywords: [] },
    };
    expect(isLocalBusinessIcp(nonLocal)).toBe(false);
    expect(leadSources[2]?.plan(nonLocal, PROFILE)).toEqual([]);
  });
});

describe('enabled sources', () => {
  it('turns on the five free sources and keeps paid sources off by default', () => {
    const enabled = enabledLeadSources(ctx({ csv: { rows: [], mapping: {} } })).map((s) => s.id);
    expect(enabled).toEqual(['search', 'lookalike', 'places', 'registry', 'csv']);
    expect(enabled).not.toContain('apollo');
    expect(enabled).not.toContain('hunter');
  });

  it('enables a paid source only with the flag AND a workspace key', () => {
    const apollo = leadSources.find((s) => s.id === 'apollo');
    if (!apollo) throw new Error('apollo source missing');
    expect(apollo.enabled(ctx({ enabledSources: ['apollo'] }))).toBe(false);
    expect(apollo.enabled(ctx({ enabledSources: ['apollo'], paidSourcesEnabled: true }))).toBe(
      false,
    );
    expect(
      apollo.enabled(
        ctx({ enabledSources: ['apollo'], paidSourcesEnabled: true, keys: { apollo: 'k' } }),
      ),
    ).toBe(true);
  });
});

describe('budget', () => {
  it('caps a source at maxQueries and maxResults', async () => {
    const source = leadSources[0];
    if (!source) throw new Error('search source missing');
    // The ICP would plan 4 queries, but the budget allows only 1 query and 2 results.
    let queries = 0;
    const counting = ctx({
      budget: { maxQueries: 1, maxResults: 2 },
      clients: {
        ...ctx().clients,
        search: {
          find: async (q, opts) => {
            queries++;
            return fakeCompanySearch(companyPool).find(q, opts);
          },
        },
      },
    });
    const drafts = await collect(collectLeads(source, counting, ICP, PROFILE));
    expect(queries).toBe(1);
    expect(drafts.length).toBeLessThanOrEqual(2);
  });
});

describe('fake company search', () => {
  it('returns the same company for an overlapping search and lookalike query', async () => {
    const search = fakeCompanySearch(companyPool);
    const fromSearch = await search.find('Coffee chain companies in SG', { limit: 10 });
    const fromLookalike = await search.find('companies like Kaya Toast Club in SG coffee', {
      limit: 10,
    });
    const names = new Set(fromSearch.map((h) => h.name));
    expect(fromSearch.some((h) => h.name === 'Kaya Toast Club')).toBe(true);
    expect(fromLookalike.some((h) => names.has(h.name))).toBe(true);
  });
});

describe('csv source', () => {
  it('parses CSV, guesses a mapping and turns rows into company + contact drafts', () => {
    const { headers, rows } = parseCsv(
      'Company,Website,Contact Name,Job Title,Email,Country\n"Kopi, Co",kopi.example,Ayu Pratama,Ops Lead,ayu@kopi.example,ID\n',
    );
    expect(headers).toContain('Company');
    expect(rows[0]?.Company).toBe('Kopi, Co');
    const mapping = guessMapping(headers);
    expect(mapping.name).toBe('Company');
    expect(mapping.email).toBe('Email');
    const drafts = rowToDrafts(rows[0] ?? {}, mapping);
    expect(drafts.map((d) => d.kind)).toEqual(['company', 'contact']);
  });
});
