import { BusinessProfiles, Companies, Contacts, Icps, newId, WorkspaceSettings } from '@sutra/db';
import type { BusinessProfile, Icp, Id } from '@sutra/domain';
import { emailConfidence } from '@sutra/domain';
import { fakeEmailVerifier } from '@sutra/sources';
import { afterEach, describe, expect, it } from 'vitest';
import { completion, mockProxy } from '../../test/mock-proxy.ts';
import { defineAgent } from '../agent.ts';
import { extractedContacts } from '../agents/prospector.ts';
import type { NodeContext } from '../pipeline/define.ts';
import { findContacts } from './contact-finder.ts';
import { prospectorDeps, setProspectorDeps } from './deps.ts';
import { enabledProspectorSources, runProspectorSource } from './run.ts';

const proxy = await mockProxy();

const ICP: Icp = {
  firmographics: {
    industries: ['Coffee chain', 'Bakery', 'Beverage chain', 'Restaurant group'],
    sizes: ['11-50', '51-200'],
    countries: ['SG', 'ID', 'VN', 'MY'],
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
  rationale: 'Multi-outlet F&B brands in SEA.',
};

const PROFILE: BusinessProfile = {
  name: 'PixelPress',
  website: 'https://pixelpress.sg',
  oneLiner: 'Packaging for F&B brands.',
  offerings: [],
  proofPoints: [],
  customers: [
    {
      name: 'Kaya Toast Club',
      domain: 'kayatoastclub.example',
      sourceUrl: 'https://pixelpress.sg',
    },
  ],
  geographies: ['SG'],
  differentiators: [],
  competitors: [],
  toneOfVoice: 'Friendly.',
  sources: ['https://pixelpress.sg'],
};

async function seedWorkspace(): Promise<Id> {
  const ws = newId();
  await WorkspaceSettings.create(ws, {
    website: 'https://pixelpress.sg',
    senderName: 'Mei',
    homeCountry: 'SG',
    timezone: 'Asia/Singapore',
    businessHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    warmup: {},
  });
  await BusinessProfiles.create(ws, { ...PROFILE, status: 'confirmed', version: 1 });
  await Icps.create(ws, { ...ICP, status: 'confirmed', version: 1 });
  return ws;
}

const node = (workspaceId: Id, item?: string): NodeContext => ({
  workspaceId,
  runId: newId(),
  nodeId: item ? `prospector.${item}` : 'prospector',
  ...(item && { item }),
});

describe('multi-source prospecting', () => {
  afterEach(() => setProspectorDeps({}));

  it('fans out over the free sources and keeps paid sources off by default', async () => {
    const ws = await seedWorkspace();
    const ids = await enabledProspectorSources(node(ws));
    expect(ids).toEqual(expect.arrayContaining(['search', 'lookalike', 'places', 'registry']));
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(ids).not.toContain('apollo');
    expect(ids).not.toContain('hunter');
  });

  it('merges a company found by several sources into one, with no duplicates', async () => {
    const ws = await seedWorkspace();
    for (const id of await enabledProspectorSources(node(ws)))
      await runProspectorSource(node(ws, id));

    const companies = await Companies.find(ws, {});
    const domains = companies.map((c) => c.domain).filter(Boolean);
    // Zero duplicate companies: one document per domain.
    expect(new Set(domains).size).toBe(domains.length);
    expect(companies.length).toBeGreaterThanOrEqual(3);

    // Every company records at least one source.
    for (const company of companies) expect(company.sources.length).toBeGreaterThanOrEqual(1);

    // Lion City Bakes is found by search, Places and the registry — three sources on one company.
    const lionCity = companies.find((c) => c.domain === 'lioncitybakes.example');
    expect(lionCity).toBeDefined();
    const lionCitySources = new Set(lionCity?.sources.map((s) => s.source));
    expect(lionCitySources).toEqual(new Set(['search', 'places', 'registry']));

    // A lookalike records which customer it resembles.
    const kaya = companies.find((c) => c.domain === 'kayatoastclub.example');
    const lookalike = kaya?.sources.find((s) => s.source === 'lookalike');
    expect(lookalike?.resembles).toBe('Kaya Toast Club');

    // Every contact has an email confidence (role inbox here, since these sites aren't crawlable).
    const contacts = await Contacts.find(ws, {});
    expect(contacts.length).toBeGreaterThanOrEqual(1);
    for (const contact of contacts)
      expect(emailConfidence.options).toContain(contact.emailConfidence);
  });

  it('finds contacts from a crawlable site with persona match and email confidence', async () => {
    const ws = await seedWorkspace();
    // A contact extractor pointed at the mock proxy; the real one would hit LiteLLM.
    const extractor = defineAgent({
      name: 'contactExtractor',
      model: proxy.model(),
      instruction: 'Extract contacts.',
      output: extractedContacts,
    });
    proxy.reply({
      json: completion(
        JSON.stringify({
          contacts: [
            { name: 'Mei Tan', title: 'Head of Operations', email: 'mei@freshcrate.com' },
            { name: 'Sam Lee', title: 'Ops Manager' },
          ],
        }),
      ),
    });
    const deps = {
      ...prospectorDeps(),
      contactExtractor: extractor,
      emailVerifier: fakeEmailVerifier(['freshcrate.com']),
    };

    const drafts = await findContacts({
      workspaceId: ws,
      company: { name: 'FreshCrate', domain: 'freshcrate.com' },
      personas: ICP.personas,
      source: 'search',
      deps,
    });

    const mei = drafts.find((d) => d.email === 'mei@freshcrate.com');
    expect(mei).toMatchObject({ emailConfidence: 'verified', personaMatch: 'Head of Operations' });
    const sam = drafts.find((d) => d.name === 'Sam Lee');
    // No published email → pattern-guessed against a domain with MX.
    expect(sam).toMatchObject({
      email: 'sam.lee@freshcrate.com',
      emailConfidence: 'pattern',
      personaMatch: 'Head of Operations',
    });
  });

  it('returns no sources until the ICP and profile exist', async () => {
    const ws = newId();
    expect(await enabledProspectorSources(node(ws))).toEqual([]);
    expect(await runProspectorSource(node(ws, 'search'))).toMatchObject({
      summary: expect.stringMatching(/No confirmed ICP/),
    });
  });
});
