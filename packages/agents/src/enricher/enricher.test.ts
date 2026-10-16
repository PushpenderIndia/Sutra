import { Companies, Contacts, Icps, LlmUsage, newId, Suppressions } from '@sutra/db';
import type { Icp, Id } from '@sutra/domain';
import { llmProspectScore } from '@sutra/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { completion, mockProxy } from '../../test/mock-proxy.ts';
import { defineAgent } from '../agent.ts';
import type { NodeContext } from '../pipeline/define.ts';
import { setEnricherDeps } from './deps.ts';
import { enricherFixtures } from './fixtures.ts';
import { fakeCompanyResearcher } from './researcher.ts';
import { runEnricher } from './run.ts';

const proxy = await mockProxy();

const ICP: Icp = {
  firmographics: {
    industries: ['Coffee chain', 'Bakery'],
    sizes: ['11-50', '51-200'],
    countries: ['SG', 'ID', 'VN'],
    keywords: [],
    technologies: [],
  },
  personas: [
    {
      title: 'Head of Operations',
      altTitles: ['Ops Manager'],
      seniority: 'director',
      pains: [],
      goals: [],
      objections: [],
    },
  ],
  buyingSignals: ['opened a new outlet', 'launched a delivery menu'],
  disqualifiers: ['franchise only'],
  rationale: 'Multi-outlet F&B brands in SEA.',
};

const scoreReply = () => ({
  json: completion(
    JSON.stringify({
      score: 85,
      reasons: [
        {
          text: 'Recent outlet expansion matches the ICP',
          weight: 0.6,
          evidence: 'opened a new outlet',
        },
      ],
    }),
  ),
});

/** A scorer agent pointed at the mock proxy, in place of the real `sutra-fast` one. */
const proxyScorer = () =>
  defineAgent({
    name: 'scorer',
    model: proxy.model(),
    instruction: 'Score the prospect.',
    output: llmProspectScore,
  });

async function seedIcp(): Promise<Id> {
  const ws = newId();
  await Icps.create(ws, { ...ICP, status: 'confirmed', version: 1 });
  return ws;
}

const addCompany = (
  ws: Id,
  over: Partial<Parameters<typeof Companies.create>[1]> & {
    name: string;
    domain: string;
    country: string;
  },
) =>
  Companies.create(ws, {
    normalizedName: over.name.toLowerCase(),
    website: `https://${over.domain}`,
    industry: 'Coffee chain',
    size: '11-50',
    sources: [{ source: 'search', ref: 'q', at: new Date() }],
    status: 'new',
    ...over,
  });

const addContact = (ws: Id, companyId: Id, over: Record<string, unknown> = {}) =>
  Contacts.create(ws, {
    companyId,
    name: 'Mei Tan',
    title: 'Head of Operations',
    email: `mei@${newId().slice(0, 6)}.example`,
    emailConfidence: 'verified',
    personaMatch: 'Head of Operations',
    locale: 'en',
    timezone: 'Asia/Singapore',
    ...over,
  });

const node = (workspaceId: Id): NodeContext => ({
  workspaceId,
  runId: newId(),
  nodeId: 'enricher',
});

describe('enrichment and scoring', () => {
  afterEach(() => setEnricherDeps({}));

  it('disqualifies a prospect outside the ICP with zero LLM tokens', async () => {
    const ws = await seedIcp();
    setEnricherDeps({ scorer: proxyScorer(), researcher: fakeCompanyResearcher(enricherFixtures) });
    const before = proxy.requests.length;
    const company = await addCompany(ws, {
      name: 'Gotham Coffee',
      domain: 'gothamcoffee.us',
      country: 'US',
    });

    const result = await runEnricher(node(ws));

    expect(result?.summary).toMatch(/1 disqualified/);
    // No request ever reached the LLM proxy, and nothing was recorded in llm_usage.
    expect(proxy.requests.length).toBe(before);
    expect(await LlmUsage.count(ws, {})).toBe(0);

    const stored = await Companies.get(ws, company._id);
    expect(stored).toMatchObject({ status: 'disqualified', fit: 'disqualified', score: 0 });
    expect(stored?.scoreReasons[0]?.evidence).toBe('US');
  });

  it('disqualifies a suppressed domain without scoring it', async () => {
    const ws = await seedIcp();
    setEnricherDeps({ scorer: proxyScorer(), researcher: fakeCompanyResearcher(enricherFixtures) });
    await Suppressions.create(ws, {
      kind: 'manual',
      scope: 'domain',
      value: 'kopinusantara.example',
      reason: 'blocked',
      at: new Date(),
    });
    const company = await addCompany(ws, {
      name: 'Kopi Nusantara',
      domain: 'kopinusantara.example',
      country: 'ID',
    });

    await runEnricher(node(ws));
    expect((await Companies.get(ws, company._id))?.fit).toBe('disqualified');
  });

  it('researches, scores and persists a blended score with cited, sourced evidence', async () => {
    const ws = await seedIcp();
    setEnricherDeps({ scorer: proxyScorer(), researcher: fakeCompanyResearcher(enricherFixtures) });
    proxy.reply(scoreReply(), scoreReply());

    const kopi = await addCompany(ws, {
      name: 'Kopi Nusantara',
      domain: 'kopinusantara.example',
      country: 'ID',
      sources: [
        { source: 'search', ref: 'q', at: new Date() },
        { source: 'places', ref: 'p', at: new Date() },
      ],
    });
    await addContact(ws, kopi._id, { email: 'ops@kopinusantara.example', locale: 'en' });
    const lion = await addCompany(ws, {
      name: 'Lion City Bakes',
      domain: 'lioncitybakes.example',
      country: 'SG',
      industry: 'Bakery',
    });
    await addContact(ws, lion._id, { email: 'ops@lioncitybakes.example' });

    const result = await runEnricher(node(ws));
    expect(result?.summary).toMatch(/2 scored/);

    const stored = await Companies.get(ws, kopi._id);
    expect(stored?.status).toBe('scored');
    // Blend of LLM 85 and rules; lands in a real fit band.
    expect(['strong', 'medium', 'weak']).toContain(stored?.fit);
    expect(stored?.score).toBeGreaterThan(0);

    // Every research signal links to a real URL (acceptance criterion).
    expect(stored?.research?.signals.length).toBeGreaterThan(0);
    for (const signal of stored?.research?.signals ?? [])
      expect(() => new URL(signal.sourceUrl)).not.toThrow();
    expect(stored?.researchedAt).toBeInstanceOf(Date);

    // Score reasons are specific and cite evidence.
    expect(stored?.scoreReasons.length).toBeGreaterThan(0);
    for (const reason of stored?.scoreReasons ?? []) expect(reason.evidence).toBeTruthy();

    // Locale follows the website language the researcher detected (id for Kopi Nusantara).
    const contacts = await Contacts.find(ws, { companyId: kopi._id });
    expect(contacts[0]?.locale).toBe('id');
  });

  it('reuses research cached within 30 days and does not re-research', async () => {
    const ws = await seedIcp();
    let calls = 0;
    setEnricherDeps({
      scorer: proxyScorer(),
      researcher: {
        research: async (input) => {
          calls++;
          return fakeCompanyResearcher(enricherFixtures).research(input);
        },
      },
    });
    proxy.reply(scoreReply());
    const kopi = await addCompany(ws, {
      name: 'Kopi Nusantara',
      domain: 'kopinusantara.example',
      country: 'ID',
      research: enricherFixtures['kopinusantara.example'],
      researchedAt: new Date(),
    });
    await addContact(ws, kopi._id, { email: 'ops@kopinusantara.example' });

    await runEnricher(node(ws));
    expect(calls).toBe(0); // cached research was reused; the researcher was never called
    expect((await Companies.get(ws, kopi._id))?.status).toBe('scored');
  });

  it('returns early when there is no confirmed ICP', async () => {
    expect(await runEnricher(node(newId()))).toMatchObject({ summary: 'No confirmed ICP' });
  });
});
