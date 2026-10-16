import {
  approvedVariant,
  BusinessProfiles,
  Campaigns,
  Icps,
  Messages,
  newId,
  Replies,
  variantHash,
} from '@sutra/db';
import type { BusinessProfile, CampaignVariant, Icp, Id } from '@sutra/domain';
import { challengerProposal } from '@sutra/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { completion, mockProxy } from '../../test/mock-proxy.ts';
import { defineAgent } from '../agent.ts';
import { sendableVariants } from '../campaign/engine.ts';
import { variantPairFixtures } from '../copywriter/fixtures.ts';
import { seededRng } from './bandit.ts';
import { setOptimizerDeps } from './deps.ts';
import { optimizeCampaign } from './run.ts';

const proxy = await mockProxy();

const PROFILE: BusinessProfile = {
  name: 'PrintCo',
  website: 'https://printco.example',
  oneLiner: 'We print cups and takeaway packaging for F&B brands.',
  offerings: [{ name: 'Printed cups', description: 'Custom cups from 500 units in 7 days' }],
  proofPoints: [{ text: 'Over a hundred brands reorder', sourceUrl: 'https://printco.example/p' }],
  customers: [],
  geographies: ['SG'],
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
      goals: [],
      objections: [],
    },
  ],
  buyingSignals: [],
  disqualifiers: [],
  rationale: 'Multi-outlet F&B brands.',
};

function variant(over: Partial<CampaignVariant> = {}): CampaignVariant {
  const v = {
    id: newId(),
    status: 'active' as const,
    origin: 'initial' as const,
    dimension: 'subject' as const,
    hypothesis: 'h',
    subject: 'Packaging for {{company}}',
    body: 'Hi {{firstName}},\n\n{{personalization}}\n\nWe print cups.\n\n{{senderName}}',
    ...over,
  };
  return 'approvedHash' in over ? v : { ...v, approvedHash: variantHash(v) };
}

async function seedProfile(ws: Id) {
  await BusinessProfiles.create(ws, { ...PROFILE, status: 'confirmed', version: 1 });
  await Icps.create(ws, { ...ICP, status: 'confirmed', version: 1 });
}

/** Creates `n` sent outbound messages attributing to a variant (the bandit's trials). */
const addSends = (ws: Id, campaignId: Id, variantId: Id, n: number) =>
  Messages.createMany(
    ws,
    Array.from({ length: n }, () => ({
      contactId: newId(),
      campaignId,
      variantId,
      direction: 'outbound' as const,
      status: 'sent' as const,
      subject: 's',
      body: 'b',
      idempotencyKey: newId(),
    })),
  );

/** Creates `n` positive replies attributing to a variant (the reward). */
const addPositiveReplies = (ws: Id, campaignId: Id, variantId: Id, n: number) =>
  Replies.createMany(
    ws,
    Array.from({ length: n }, () => ({
      messageId: newId(),
      contactId: newId(),
      campaignId,
      variantId,
      intent: 'interested' as const,
      sentiment: 'positive' as const,
      language: 'en' as const,
      summaryEn: 'keen',
      at: new Date(),
    })),
  );

async function campaignWith(ws: Id, variants: CampaignVariant[]) {
  return Campaigns.create(ws, {
    name: 'C',
    icpVersion: 1,
    persona: 'Head of Operations',
    steps: [{ delayDays: 0, intent: 'intro', angle: 'reorders', variants }],
    status: 'running',
  });
}

const challengerAgent = () =>
  defineAgent({
    name: 'challengerWriter',
    model: proxy.model('sutra-smart'),
    instruction: 'Write a challenger.',
    output: challengerProposal,
  });
const json = (value: unknown) => ({ json: completion(JSON.stringify(value)) });
const opts = { rng: seededRng(5), draws: 3000 } as const;

afterEach(() => setOptimizerDeps({}));

describe('optimizeCampaign — challengers', () => {
  it('proposes a pending-approval challenger for a stalled step and never sends it', async () => {
    const ws = newId();
    await seedProfile(ws);
    const a = variant();
    const b = variant();
    const campaign = await campaignWith(ws, [a, b]);
    // 60 sends each, no clear winner (A leads modestly) → stalled.
    await addSends(ws, campaign._id, a.id, 60);
    await addSends(ws, campaign._id, b.id, 60);
    await addPositiveReplies(ws, campaign._id, a.id, 6);
    await addPositiveReplies(ws, campaign._id, b.id, 3);

    setOptimizerDeps({ challengerWriter: challengerAgent() });
    const fixture = variantPairFixtures[1]?.variants[0];
    proxy.reply(json(fixture));

    const result = await optimizeCampaign(ws, campaign._id, opts);
    expect(result?.challengers).toBe(1);

    const updated = await Campaigns.get(ws, campaign._id);
    const step = updated?.steps[0];
    expect(step?.variants).toHaveLength(3);
    const challenger = step?.variants.find((v) => v.origin === 'optimizer');
    expect(challenger).toMatchObject({
      status: 'pending_approval',
      origin: 'optimizer',
      parentId: a.id,
    });
    expect(challenger?.dimension).not.toBe(a.dimension); // changes exactly one, different dimension
    expect(challenger?.flags ?? []).toEqual([]); // passed the quality gate

    // It is NOT sendable: no approved-variant permit, and the engine excludes it.
    expect(await approvedVariant(ws, campaign._id, challenger?.id ?? '')).toBeNull();
    expect(step && sendableVariants(step).map((v) => v.id)).toEqual([a.id, b.id]);
  });

  it('is idempotent: a second pass adds no further challenger while one is pending', async () => {
    const ws = newId();
    await seedProfile(ws);
    const a = variant();
    const b = variant();
    const campaign = await campaignWith(ws, [a, b]);
    await addSends(ws, campaign._id, a.id, 60);
    await addSends(ws, campaign._id, b.id, 60);
    await addPositiveReplies(ws, campaign._id, a.id, 6);
    await addPositiveReplies(ws, campaign._id, b.id, 3);

    setOptimizerDeps({ challengerWriter: challengerAgent() });
    proxy.reply(json(variantPairFixtures[1]?.variants[0]));
    expect((await optimizeCampaign(ws, campaign._id, opts))?.challengers).toBe(1);

    const again = await optimizeCampaign(ws, campaign._id, opts);
    expect(again?.challengers).toBe(0);
    expect((await Campaigns.get(ws, campaign._id))?.steps[0]?.variants).toHaveLength(3);
  });

  it('does not propose a challenger before the step has enough sends', async () => {
    const ws = newId();
    await seedProfile(ws);
    const a = variant();
    const b = variant();
    const campaign = await campaignWith(ws, [a, b]);
    await addSends(ws, campaign._id, a.id, 10);
    await addSends(ws, campaign._id, b.id, 10);

    const result = await optimizeCampaign(ws, campaign._id, opts);
    expect(result?.challengers).toBe(0);
    expect((await Campaigns.get(ws, campaign._id))?.steps[0]?.variants).toHaveLength(2);
  });
});

describe('optimizeCampaign — retire and insights', () => {
  it('auto-retires a clear loser, and the engine then assigns only the survivors', async () => {
    const ws = newId();
    await seedProfile(ws);
    const a = variant();
    const b = variant();
    const campaign = await campaignWith(ws, [a, b]);
    // A is a runaway winner (≥100 sends, >95% P(best)); B has 0 rewards over 60 sends → retire.
    await addSends(ws, campaign._id, a.id, 140);
    await addSends(ws, campaign._id, b.id, 60);
    await addPositiveReplies(ws, campaign._id, a.id, 70);

    const result = await optimizeCampaign(ws, campaign._id, opts);
    expect(result?.retired).toBe(1);
    expect(result?.winners).toBe(1);
    // No challenger: the leader is a declared winner, so the step is not "stalled".
    expect(result?.challengers).toBe(0);

    const step = (await Campaigns.get(ws, campaign._id))?.steps[0];
    const retired = step?.variants.find((v) => v.id === b.id);
    expect(retired?.status).toBe('retired');
    // Retired arms receive no new assignments.
    expect(step && sendableVariants(step).map((v) => v.id)).toEqual([a.id]);
  });

  it('records insights that cite the numbers behind them', async () => {
    const ws = newId();
    await seedProfile(ws);
    const a = variant();
    const b = variant();
    const campaign = await campaignWith(ws, [a, b]);
    await addSends(ws, campaign._id, a.id, 140);
    await addSends(ws, campaign._id, b.id, 60);
    await addPositiveReplies(ws, campaign._id, a.id, 70);

    const result = await optimizeCampaign(ws, campaign._id, opts);
    expect(result?.insights.length).toBeGreaterThan(0);
    // Every insight cites its data (sends / replies / P(best)).
    for (const insight of result?.insights ?? []) expect(insight.text).toMatch(/\d/);
    expect(result?.insights.some((i) => /P\(best\)/.test(i.text))).toBe(true);

    const stored = await Campaigns.get(ws, campaign._id);
    expect(stored?.insights?.length).toBe(result?.insights.length);
  });
});
