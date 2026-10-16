import { newId } from '@sutra/db';
import type { Campaign, CampaignVariant, Enrollment, Message } from '@sutra/domain';
import { describe, expect, it } from 'vitest';
import { seededRng } from '../optimizer/bandit.ts';
import { nextAction, pickVariant, sendableVariants } from './engine.ts';

const NOW = new Date('2026-10-13T02:00:00Z');

function variant(over: Partial<CampaignVariant> = {}): CampaignVariant {
  const base = {
    id: newId(),
    status: 'active' as const,
    origin: 'initial' as const,
    dimension: 'subject' as const,
    hypothesis: 'h',
    subject: 'Hi {{company}}',
    body: 'Body',
    approvedHash: 'hash',
    ...over,
  };
  return base;
}

function campaign(steps: Campaign['steps'], over: Partial<Campaign> = {}): Campaign {
  return {
    _id: newId(),
    workspaceId: newId(),
    createdAt: NOW,
    updatedAt: NOW,
    name: 'C',
    icpVersion: 1,
    steps,
    reward: 'positive_reply',
    status: 'running',
    ...over,
  };
}

function enrollment(over: Partial<Enrollment> = {}): Enrollment {
  return {
    _id: newId(),
    workspaceId: newId(),
    createdAt: NOW,
    updatedAt: NOW,
    contactId: newId(),
    campaignId: newId(),
    stepIndex: 0,
    status: 'active',
    assignedVariants: {},
    ...over,
  };
}

const msg = (over: Partial<Message>): Message =>
  ({
    _id: newId(),
    workspaceId: newId(),
    createdAt: NOW,
    updatedAt: NOW,
    contactId: newId(),
    direction: 'outbound',
    status: 'sent',
    subject: 's',
    body: 'b',
    idempotencyKey: newId(),
    ...over,
  }) as Message;

const twoSteps = () => [
  { delayDays: 0, variants: [variant()] },
  { delayDays: 3, variants: [variant()] },
];

describe('nextAction', () => {
  it('sends the current step when it is due and has an approved variant', () => {
    expect(nextAction(enrollment(), campaign(twoSteps()), [], NOW)).toEqual({
      type: 'send',
      stepIndex: 0,
    });
  });

  it('waits until nextRunAt when the step is scheduled for later', () => {
    const until = new Date(NOW.getTime() + 60_000);
    expect(nextAction(enrollment({ nextRunAt: until }), campaign(twoSteps()), [], NOW)).toEqual({
      type: 'wait',
      until,
    });
  });

  it('sends once nextRunAt has passed', () => {
    const past = new Date(NOW.getTime() - 1);
    expect(nextAction(enrollment({ nextRunAt: past }), campaign(twoSteps()), [], NOW).type).toBe(
      'send',
    );
  });

  it('stops on an inbound reply, even on a later step (a reply ends the sequence)', () => {
    const thread = [msg({ direction: 'inbound', status: 'received' })];
    const enr = enrollment({ stepIndex: 1 });
    expect(nextAction(enr, campaign(twoSteps()), thread, NOW)).toEqual({
      type: 'stop',
      reason: 'replied',
    });
  });

  it('stops on a bounced send', () => {
    const thread = [msg({ direction: 'outbound', status: 'bounced' })];
    expect(nextAction(enrollment(), campaign(twoSteps()), thread, NOW)).toEqual({
      type: 'stop',
      reason: 'bounced',
    });
  });

  it('stops with campaign_done past the last step', () => {
    expect(nextAction(enrollment({ stepIndex: 2 }), campaign(twoSteps()), [], NOW)).toEqual({
      type: 'stop',
      reason: 'campaign_done',
    });
  });

  it('keeps a terminal enrollment stopped with its recorded reason', () => {
    const enr = enrollment({ status: 'stopped', stopReason: 'opted_out' });
    expect(nextAction(enr, campaign(twoSteps()), [], NOW)).toEqual({
      type: 'stop',
      reason: 'opted_out',
    });
  });

  it('skips a step whose only variant is unapproved (edited back to draft)', () => {
    const steps = [
      { delayDays: 0, variants: [variant({ status: 'draft', approvedHash: undefined })] },
    ];
    expect(nextAction(enrollment(), campaign(steps), [], NOW)).toEqual({
      type: 'skip',
      stepIndex: 0,
      reason: 'no_approved_variant',
    });
  });

  it('still sends when a sibling variant is approved although one was edited', () => {
    const steps = [
      {
        delayDays: 0,
        variants: [variant({ status: 'draft', approvedHash: undefined }), variant()],
      },
    ];
    expect(nextAction(enrollment(), campaign(steps), [], NOW).type).toBe('send');
  });
});

describe('sendableVariants / pickVariant', () => {
  it('excludes variants without an approved hash or a sendable status', () => {
    const step = {
      delayDays: 0,
      variants: [
        variant(),
        variant({ status: 'draft', approvedHash: undefined }),
        variant({ status: 'rejected' }),
        variant({ approvedHash: undefined }),
      ],
    };
    expect(sendableVariants(step)).toHaveLength(1);
  });

  it('returns the only sendable variant without consulting the bandit', () => {
    const a = variant();
    const step = { delayDays: 0, variants: [a, variant({ status: 'paused' })] };
    expect(pickVariant(step)?.id).toBe(a.id);
  });

  it('only ever assigns a sendable variant (never an unapproved or retired one)', () => {
    const a = variant();
    const b = variant();
    const step = {
      delayDays: 0,
      variants: [
        a,
        b,
        variant({ status: 'paused' }),
        variant({ status: 'retired' }),
        variant({ status: 'draft', approvedHash: undefined }),
      ],
    };
    const rng = seededRng(7);
    const sendable = new Set([a.id, b.id]);
    for (let i = 0; i < 200; i++) {
      const picked = pickVariant(step, () => ({ sends: 0, successes: 0 }), rng);
      expect(picked && sendable.has(picked.id)).toBe(true);
    }
  });

  it('favours the arm with the higher reward rate (Thompson sampling)', () => {
    const a = variant();
    const b = variant();
    const step = { delayDays: 0, variants: [a, b] };
    // A: 40/100 rewards, B: 10/100 — A should win the large majority of assignments.
    const stats = (id: string) =>
      id === a.id ? { sends: 100, successes: 40 } : { sends: 100, successes: 10 };
    const rng = seededRng(42);
    let picksA = 0;
    for (let i = 0; i < 500; i++) if (pickVariant(step, stats, rng)?.id === a.id) picksA++;
    expect(picksA).toBeGreaterThan(400);
  });

  it('returns undefined when nothing is sendable', () => {
    const step = {
      delayDays: 0,
      variants: [variant({ status: 'draft', approvedHash: undefined })],
    };
    expect(pickVariant(step)).toBeUndefined();
  });
});
