import {
  BusinessProfiles,
  Campaigns,
  Companies,
  Contacts,
  Icps,
  newId,
  Personalizations,
} from '@sutra/db';
import type { BusinessProfile, Icp, Id } from '@sutra/domain';
import { personalizationLine, sequencePlan, variantPair, variantTranslation } from '@sutra/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { completion, mockProxy } from '../../test/mock-proxy.ts';
import { defineAgent } from '../agent.ts';
import { enricherFixtures } from '../enricher/fixtures.ts';
import type { NodeContext } from '../pipeline/define.ts';
import { setCopywriterDeps } from './deps.ts';
import {
  personalizationFixture,
  sequencePlanFixture,
  translationFixtures,
  variantPairFixtures,
} from './fixtures.ts';
import { personalizeForContact } from './personalize.ts';
import { regenerateStep, runCopywriter } from './run.ts';

const proxy = await mockProxy();

const PROFILE: BusinessProfile = {
  name: 'PrintCo',
  website: 'https://printco.example',
  oneLiner: 'We print cups and takeaway packaging for F&B brands.',
  offerings: [
    { name: 'Printed cups', description: 'Custom-printed cups from 500 units in 7 days' },
  ],
  proofPoints: [
    { text: 'Over a hundred F&B brands reorder', sourceUrl: 'https://printco.example/proof' },
  ],
  customers: [],
  geographies: ['SG', 'ID'],
  differentiators: ['7-day turnaround'],
  competitors: [],
  toneOfVoice: 'Plain, specific and human.',
  sources: ['https://printco.example'],
};

const ICP: Icp = {
  firmographics: {
    industries: ['Coffee chain'],
    sizes: ['11-50'],
    countries: ['ID'],
    keywords: [],
    technologies: [],
  },
  personas: [
    {
      title: 'Head of Operations',
      altTitles: [],
      seniority: 'director',
      pains: ['slow reorders'],
      goals: ['grow outlets'],
      objections: [],
    },
  ],
  buyingSignals: ['opened a new outlet'],
  disqualifiers: [],
  rationale: 'Multi-outlet F&B brands in SEA.',
};

async function seed(icp: Icp = ICP): Promise<Id> {
  const ws = newId();
  await BusinessProfiles.create(ws, { ...PROFILE, status: 'confirmed', version: 1 });
  await Icps.create(ws, { ...icp, status: 'confirmed', version: 1 });
  return ws;
}

const addCompany = (ws: Id, over: Partial<Parameters<typeof Companies.create>[1]> = {}) =>
  Companies.create(ws, {
    name: 'Kopi Nusantara',
    normalizedName: 'kopi nusantara',
    domain: 'kopinusantara.example',
    website: 'https://kopinusantara.example',
    country: 'ID',
    sources: [{ source: 'search', ref: 'q', at: new Date() }],
    status: 'scored',
    ...over,
  });

const addContact = (ws: Id, companyId: Id, over: Record<string, unknown> = {}) =>
  Contacts.create(ws, {
    companyId,
    firstName: 'Budi',
    name: 'Budi Santoso',
    title: 'Head of Operations',
    email: `budi-${newId().slice(0, 6)}@kopinusantara.example`,
    emailConfidence: 'verified',
    personaMatch: 'Head of Operations',
    locale: 'id',
    timezone: 'Asia/Jakarta',
    ...over,
  });

const proxyAgents = () => ({
  sequencePlanner: defineAgent({
    name: 'sequencePlanner',
    model: proxy.model('sutra-smart'),
    instruction: 'Plan.',
    output: sequencePlan,
  }),
  variantWriter: defineAgent({
    name: 'variantWriter',
    model: proxy.model('sutra-smart'),
    instruction: 'Write.',
    output: variantPair,
  }),
  translator: defineAgent({
    name: 'translator',
    model: proxy.model('sutra-smart'),
    instruction: 'Translate.',
    output: variantTranslation,
  }),
  personalizer: defineAgent({
    name: 'personalizer',
    model: proxy.model('sutra-fast'),
    instruction: 'Personalise.',
    output: personalizationLine,
  }),
});

const json = (value: unknown) => ({ json: completion(JSON.stringify(value)) });
const node = (workspaceId: Id): NodeContext => ({
  workspaceId,
  runId: newId(),
  nodeId: 'copywriter',
});

/** The most recent campaign, narrowed to defined so tests read without non-null assertions. */
async function latestCampaign(ws: Id) {
  const [campaign] = await Campaigns.find(ws, {}, { sort: { createdAt: -1 } });
  if (!campaign) throw new Error('expected a campaign');
  return campaign;
}

afterEach(() => setCopywriterDeps({}));

describe('campaign generation', () => {
  it('drafts one campaign per persona with A/B variants and localised templates', async () => {
    const ws = await seed();
    const company = await addCompany(ws);
    await addContact(ws, company._id); // locale 'id' → one translation locale
    setCopywriterDeps(proxyAgents());
    proxy.reply(
      json(sequencePlanFixture),
      json(variantPairFixtures[0]),
      json(translationFixtures.id),
      json(translationFixtures.id),
      json(variantPairFixtures[1]),
      json(translationFixtures.id),
      json(translationFixtures.id),
      json(variantPairFixtures[2]),
      json(translationFixtures.id),
      json(translationFixtures.id),
    );

    const result = await runCopywriter(node(ws));
    expect(result?.summary).toMatch(/1 campaign/);

    const campaign = await latestCampaign(ws);
    expect(campaign).toMatchObject({
      persona: 'Head of Operations',
      icpVersion: 1,
      status: 'draft',
    });
    expect(campaign.steps).toHaveLength(3);

    for (const step of campaign.steps) {
      const [a, b] = step.variants;
      expect(step.variants).toHaveLength(2);
      // Each variant is a fresh draft template written by the copywriter.
      for (const v of step.variants)
        expect(v).toMatchObject({ status: 'draft', origin: 'initial' });
      expect(a?.id).not.toBe(b?.id);
      // The two variants of a step declare the same single dimension under test.
      expect(a?.dimension).toBe(b?.dimension);
      // No merge field leaks and the gate passed (no flags).
      expect(a?.flags ?? []).toEqual([]);
    }

    // Step 1 varies the subject: subjects differ, bodies match.
    const [s0a, s0b] = campaign.steps[0]?.variants ?? [];
    expect(s0a?.subject).not.toBe(s0b?.subject);
    expect(s0a?.body).toBe(s0b?.body);

    // The Indonesian translation is attached with merge fields preserved (acceptance criterion).
    const id = s0a?.translations?.id;
    expect(id?.body).toContain('{{firstName}}');
    expect(id?.body).toContain('{{personalization}}');
    expect(id?.body).toContain('{{senderName}}');
    expect(id?.subject).toContain('{{company}}');
    expect(id?.body).toMatch(/Bapak\/Ibu/);
  });

  it('regenerates a variant pair that fails the quality gate', async () => {
    const ws = await seed();
    const company = await addCompany(ws);
    await addContact(ws, company._id, { locale: 'en' }); // English only → no translation calls
    setCopywriterDeps(proxyAgents());

    const spammy = {
      variants: [
        {
          hypothesis: 'h',
          dimension: 'cta' as const,
          subject: 'Act now for a FREE deal',
          body: 'Hi {{firstName}}, {{personalization}} click here {{senderName}}',
        },
        {
          hypothesis: 'h',
          dimension: 'cta' as const,
          subject: 'Another FREE deal',
          body: 'Hi {{firstName}}, {{personalization}} buy now {{senderName}}',
        },
      ],
    };
    proxy.reply(
      json(sequencePlanFixture),
      json(spammy), // step 0, rejected by the gate
      json(variantPairFixtures[0]), // step 0, regenerated and accepted
      json(variantPairFixtures[1]), // step 1
      json(variantPairFixtures[2]), // step 2
    );

    const before = proxy.requests.length;
    await runCopywriter(node(ws));
    // One sequence plan + (2 writes for step 0) + 1 write each for steps 1 and 2 = 5 calls.
    expect(proxy.requests.length - before).toBe(5);

    const campaign = await latestCampaign(ws);
    const first = campaign.steps[0]?.variants[0];
    expect(first?.subject).not.toMatch(/FREE/);
    expect(first?.flags ?? []).toEqual([]);
  });

  it('is idempotent: a second run drafts nothing new', async () => {
    const ws = await seed();
    const company = await addCompany(ws);
    await addContact(ws, company._id, { locale: 'en' });
    setCopywriterDeps(proxyAgents());
    proxy.reply(
      json(sequencePlanFixture),
      json(variantPairFixtures[0]),
      json(variantPairFixtures[1]),
      json(variantPairFixtures[2]),
    );
    await runCopywriter(node(ws));
    expect(await Campaigns.count(ws, {})).toBe(1);

    const result = await runCopywriter(node(ws)); // no replies queued; must make no LLM calls
    expect(result?.summary).toBe('Up to date');
    expect(await Campaigns.count(ws, {})).toBe(1);
  });

  it('regenerates a step pair from a reviewer note, as fresh drafts', async () => {
    const ws = await seed();
    const company = await addCompany(ws);
    await addContact(ws, company._id, { locale: 'en' });
    setCopywriterDeps(proxyAgents());
    proxy.reply(
      json(sequencePlanFixture),
      json(variantPairFixtures[0]),
      json(variantPairFixtures[1]),
      json(variantPairFixtures[2]),
    );
    await runCopywriter(node(ws));
    const before = await latestCampaign(ws);
    const oldIds = before.steps[0]?.variants.map((v) => v.id);

    proxy.reply(json(variantPairFixtures[2])); // the fresh pair for step 0
    const step = await regenerateStep({
      workspaceId: ws,
      campaignId: before._id,
      stepIndex: 0,
      note: 'make it more casual',
    });
    expect(step?.variants).toHaveLength(2);

    const after = await latestCampaign(ws);
    const newIds = after.steps[0]?.variants.map((v) => v.id);
    expect(newIds).not.toEqual(oldIds); // regenerated variants are new drafts
    expect(after.steps[0]?.variants[0]?.subject).toBe(variantPairFixtures[2]?.variants[0]?.subject);
    expect(after.steps[1]?.variants[0]?.id).toBe(before.steps[1]?.variants[0]?.id); // other steps untouched
  });

  it('returns early without a confirmed profile or ICP', async () => {
    expect(await runCopywriter(node(newId()))).toMatchObject({ summary: 'No confirmed profile' });
    const ws = newId();
    await BusinessProfiles.create(ws, { ...PROFILE, status: 'confirmed', version: 1 });
    expect(await runCopywriter(node(ws))).toMatchObject({ summary: 'No confirmed ICP' });
  });
});

describe('per-contact personalisation', () => {
  const researched = (ws: Id) =>
    addCompany(ws, {
      research: enricherFixtures['kopinusantara.example'],
      researchedAt: new Date(),
    });

  it('writes a grounded, cited line in the contact locale and caches it', async () => {
    const ws = await seed();
    const company = await researched(ws);
    const contact = await addContact(ws, company._id);
    setCopywriterDeps({ personalizer: proxyAgents().personalizer });
    proxy.reply(json(personalizationFixture));

    const campaignId = newId();
    const before = proxy.requests.length;
    const line = await personalizeForContact({
      workspaceId: ws,
      contact,
      company,
      campaignId,
      stepIndex: 0,
    });
    expect(line?.sourceUrl).toBe(personalizationFixture.sourceUrl);
    expect(line?.locale).toBe('id');
    // The cited URL is one the research actually contains.
    expect((company.research?.signals ?? []).some((s) => s.sourceUrl === line?.sourceUrl)).toBe(
      true,
    );
    expect(await Personalizations.count(ws, { contactId: contact._id })).toBe(1);

    // A second call reuses the cache — no further LLM request.
    const again = await personalizeForContact({
      workspaceId: ws,
      contact,
      company,
      campaignId,
      stepIndex: 0,
    });
    expect(again?._id).toBe(line?._id);
    expect(proxy.requests.length).toBe(before + 1);
  });

  it('regenerates once when the first line is not grounded', async () => {
    const ws = await seed();
    const company = await researched(ws);
    const contact = await addContact(ws, company._id);
    setCopywriterDeps({ personalizer: proxyAgents().personalizer });
    proxy.reply(
      json({ line: 'Made up fact.', sourceUrl: 'https://not-in-research.example' }),
      json(personalizationFixture),
    );

    const before = proxy.requests.length;
    const line = await personalizeForContact({
      workspaceId: ws,
      contact,
      company,
      campaignId: newId(),
      stepIndex: 1,
    });
    expect(proxy.requests.length - before).toBe(2);
    expect(line?.sourceUrl).toBe(personalizationFixture.sourceUrl);
  });

  it('returns undefined when the company has no research to ground on', async () => {
    const ws = await seed();
    const company = await addCompany(ws); // no research
    const contact = await addContact(ws, company._id);
    setCopywriterDeps({ personalizer: proxyAgents().personalizer });
    expect(
      await personalizeForContact({
        workspaceId: ws,
        contact,
        company,
        campaignId: newId(),
        stepIndex: 0,
      }),
    ).toBeUndefined();
  });
});
