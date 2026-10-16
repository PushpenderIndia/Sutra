import { newId } from '@sutra/db';
import type { Campaign, CampaignVariant, Enrollment, Message } from '@sutra/domain';
import { describe, expect, it } from 'vitest';
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

  it('picks uniformly among sendable variants and never an unapproved one', () => {
    const a = variant();
    const b = variant();
    const step = { delayDays: 0, variants: [a, b, variant({ status: 'paused' })] };
    expect(pickVariant(step, () => 0)?.id).toBe(a.id);
    expect(pickVariant(step, () => 0.99)?.id).toBe(b.id);
  });

  it('returns undefined when nothing is sendable', () => {
    const step = {
      delayDays: 0,
      variants: [variant({ status: 'draft', approvedHash: undefined })],
    };
    expect(pickVariant(step)).toBeUndefined();
  });
});
