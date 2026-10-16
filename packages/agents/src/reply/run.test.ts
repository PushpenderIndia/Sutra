import {
  Campaigns,
  Companies,
  Contacts,
  Enrollments,
  Mailboxes,
  Messages,
  migrate,
  newId,
  Replies,
  Suppressions,
  WorkspaceSettings,
} from '@sutra/db';
import type { Id } from '@sutra/domain';
import { fakeCalendarClient } from '@sutra/mail';
import { beforeAll, describe, expect, it } from 'vitest';
import { fakeReplyAnalyzer, type ReplyAnalyzer } from './analyzer.ts';
import type { ReplyDeps } from './deps.ts';
import { analyzeReply } from './run.ts';

const AT = new Date('2026-10-19T00:00:00Z');

beforeAll(() => migrate());

const deps = (analyzer: ReplyAnalyzer): ReplyDeps => ({
  analyzer,
  calendarFor: () => fakeCalendarClient(),
});

/** A workspace with a mailbox, a contacted lead, a running campaign and an active enrollment. */
async function setup() {
  const ws = newId();
  await WorkspaceSettings.create(ws, {
    senderName: 'Mei Tan',
    homeCountry: 'JP',
    timezone: 'Asia/Tokyo',
    businessHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    warmup: {},
  });
  await Mailboxes.create(ws, {
    userId: 'fake',
    email: `mei-${ws.slice(-6)}@mailbox.example`,
    historyId: '1',
  });
  const company = await Companies.create(ws, {
    name: 'Acme',
    normalizedName: 'acme',
    domain: 'acme.example',
    country: 'JP',
    sources: [{ source: 'search', ref: 'q', at: AT }],
  });
  const contact = await Contacts.create(ws, {
    companyId: company._id,
    name: 'Ana Sato',
    firstName: 'Ana',
    email: 'ana@acme.example',
    emailConfidence: 'verified',
    locale: 'ja',
    timezone: 'Asia/Tokyo',
    status: 'contacted',
  });
  const variantId = newId();
  const campaign = await Campaigns.create(ws, {
    name: 'C',
    icpVersion: 1,
    steps: [{ delayDays: 0, variants: [] }],
    status: 'running',
  });
  const enrollment = await Enrollments.create(ws, {
    contactId: contact._id,
    campaignId: campaign._id,
    stepIndex: 0,
    status: 'active',
    assignedVariants: { '0': variantId },
    nextRunAt: AT,
  });
  return { ws, company, contact, campaign, enrollment, variantId };
}

/** Files an inbound reply the way `@sutra/mail` sync does, with its variant attribution. */
async function inboundReply(ws: Id, contactId: Id, campaignId: Id, variantId: Id, body: string) {
  return Messages.create(ws, {
    contactId,
    campaignId,
    stepIndex: 0,
    variantId,
    direction: 'inbound',
    status: 'received',
    from: 'ana@acme.example',
    to: 'mei@mailbox.example',
    subject: 'Re: Packaging for Acme',
    body,
    threadId: 'thread-1',
    idempotencyKey: `in:${contactId}`,
  });
}

describe('analyzeReply — interested', () => {
  it('records the analysis with attribution, flips status, stops the sequence and drafts a reply', async () => {
    const { ws, contact, campaign, enrollment, variantId } = await setup();
    const msg = await inboundReply(
      ws,
      contact._id,
      campaign._id,
      variantId,
      'Interested. Can we talk next Tuesday afternoon?',
    );

    const result = await analyzeReply(ws, msg._id, { now: AT, deps: deps(fakeReplyAnalyzer()) });
    expect(result?.intent).toBe('meeting_request');

    const reply = await Replies.findOne(ws, { messageId: msg._id });
    expect(reply?.intent).toBe('meeting_request');
    expect(reply?.variantId).toBe(variantId); // variant attribution
    expect(reply?.campaignId).toBe(campaign._id);

    expect((await Contacts.get(ws, contact._id))?.status).toBe('interested');
    expect((await Enrollments.get(ws, enrollment._id))?.status).toBe('stopped');

    const draft = await Messages.findOne(ws, { contactId: contact._id, status: 'draft' });
    expect(draft?.direction).toBe('outbound');
    expect(draft?.subject).toMatch(/^Re:/);
    expect(draft?.body).toContain('Which works best');
  });

  it('is idempotent: a second analysis of the same reply does nothing', async () => {
    const { ws, contact, campaign, variantId } = await setup();
    const msg = await inboundReply(
      ws,
      contact._id,
      campaign._id,
      variantId,
      'Interested. Can we talk next Tuesday afternoon?',
    );
    await analyzeReply(ws, msg._id, { now: AT, deps: deps(fakeReplyAnalyzer()) });
    const again = await analyzeReply(ws, msg._id, { now: AT, deps: deps(fakeReplyAnalyzer()) });
    expect(again).toBeNull();
    expect(await Replies.count(ws, { messageId: msg._id })).toBe(1);
    expect(await Messages.count(ws, { contactId: contact._id, status: 'draft' })).toBe(1);
  });
});

describe('analyzeReply — unsubscribe (acceptance: suppression within one cycle)', () => {
  it('suppresses the contact and stops the enrollment, with no draft', async () => {
    const { ws, contact, campaign, enrollment, variantId } = await setup();
    const msg = await inboundReply(
      ws,
      contact._id,
      campaign._id,
      variantId,
      'Please remove me from your list.',
    );

    const result = await analyzeReply(ws, msg._id, { now: AT, deps: deps(fakeReplyAnalyzer()) });
    expect(result?.intent).toBe('unsubscribe');
    expect((await Contacts.get(ws, contact._id))?.status).toBe('suppressed');
    expect(await Suppressions.count(ws, { value: 'ana@acme.example' })).toBe(1);
    expect((await Enrollments.get(ws, enrollment._id))?.status).toBe('stopped');
    expect(await Messages.count(ws, { contactId: contact._id, status: 'draft' })).toBe(0);
  });
});

describe('analyzeReply — not now', () => {
  it('pauses the enrollment rather than stopping it, and records a follow-up', async () => {
    const { ws, contact, campaign, enrollment, variantId } = await setup();
    const followUpAt = '2026-12-01T00:00:00.000Z';
    const msg = await inboundReply(
      ws,
      contact._id,
      campaign._id,
      variantId,
      'Not right now, maybe next quarter.',
    );
    const analyzer = fakeReplyAnalyzer({ 'Not right now, maybe next quarter.': { followUpAt } });

    const result = await analyzeReply(ws, msg._id, { now: AT, deps: deps(analyzer) });
    expect(result?.intent).toBe('not_now');
    expect((await Contacts.get(ws, contact._id))?.status).toBe('not_now');
    const enr = await Enrollments.get(ws, enrollment._id);
    expect(enr?.status).toBe('paused');
    expect(enr?.nextRunAt?.toISOString()).toBe(followUpAt);
  });
});

describe('analyzeReply — referral', () => {
  it('creates a new contact from the referral and drafts a thank-you', async () => {
    const { ws, contact, company, campaign, variantId } = await setup();
    const body = 'You should reach out to our head of ops, Jane.';
    const msg = await inboundReply(ws, contact._id, campaign._id, variantId, body);
    const analyzer = fakeReplyAnalyzer({
      [body]: { referral: { name: 'Jane Lee', email: 'jane@acme.example' } },
    });

    const result = await analyzeReply(ws, msg._id, { now: AT, deps: deps(analyzer) });
    expect(result?.intent).toBe('referral');
    const jane = await Contacts.findOne(ws, { email: 'jane@acme.example' });
    expect(jane?.companyId).toBe(company._id);
    expect(jane?.status).toBe('new');
    expect(await Messages.count(ws, { contactId: contact._id, status: 'draft' })).toBe(1);
  });
});

describe('analyzeReply — Japanese meeting request offers slots', () => {
  it('drafts a reply with concrete Tokyo-afternoon slots', async () => {
    const { ws, contact, campaign, variantId } = await setup();
    const body = '来週火曜の午後なら大丈夫です。';
    const msg = await inboundReply(ws, contact._id, campaign._id, variantId, body);
    const analyzer = fakeReplyAnalyzer({
      [body]: {
        // Tuesday 13:00–17:00 JST, expressed in UTC (Z).
        proposedTimes: [{ start: '2026-10-20T04:00:00.000Z', end: '2026-10-20T08:00:00.000Z' }],
      },
    });

    const result = await analyzeReply(ws, msg._id, { now: AT, deps: deps(analyzer) });
    expect(result?.intent).toBe('meeting_request');
    const draft = await Messages.findOne(ws, { contactId: contact._id, status: 'draft' });
    expect(draft?.body).toContain('Which works best');
    // Slots are rendered in the contact's language and time zone: Tuesday (火) afternoon in Tokyo.
    expect(draft?.body).toContain('火');
    expect(draft?.body).toContain('13:00');
  });
});
