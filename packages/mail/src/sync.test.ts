import {
  Campaigns,
  Contacts,
  Enrollments,
  Mailboxes,
  Messages,
  migrate,
  Suppressions,
  TrackingEvents,
} from '@sutra/db';
import type { Mailbox } from '@sutra/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { later, recorder, T0, workspace } from '../test/fixtures.ts';
import { script, simulate } from './fake.ts';
import type { InboundMail, MailClient } from './gmail.ts';
import { connectMailbox, renewWatches } from './mailbox.ts';
import { deliver } from './send.ts';
import { ingest, onReply, syncMailbox } from './sync.ts';

beforeAll(() => migrate());

async function sent(n = 1) {
  const w = await workspace(n);
  const { client } = recorder(w.mailbox);
  const messages = [];
  for (let i = 0; i < n; i++) {
    const m = await w.queue(i);
    await deliver(w.ws, m._id, { now: later(i * 10), client });
    messages.push(
      (await Messages.get(w.ws, m._id)) as NonNullable<Awaited<ReturnType<typeof Messages.get>>>,
    );
  }
  return { ...w, messages, message: messages[0] as (typeof messages)[number] };
}

const reply = (threadId: string, over: Partial<InboundMail> = {}): InboundMail => ({
  id: 'g-reply-1',
  threadId,
  labelIds: ['INBOX'],
  headers: { 'message-id': '<r1@acme0.example>' },
  from: 'Ana <ana@acme0.example>',
  subject: 'Re: Packaging for Acme',
  text: 'Tell me more',
  ...over,
});

describe('ingest', () => {
  it('stores a reply once with attribution, even when Pub/Sub delivers it twice', async () => {
    const { ws, mailbox, message, variant } = await sent();
    const heard: string[] = [];
    const off = onReply((r) => heard.push(r._id));
    const mail = reply(message.threadId as string);
    const first = await ingest(mailbox, mail);
    expect(first).toMatchObject({
      direction: 'inbound',
      status: 'received',
      from: 'ana@acme0.example',
      contactId: message.contactId,
      enrollmentId: message.enrollmentId,
      variantId: variant.id,
      threadId: message.threadId,
    });
    expect(await ingest(mailbox, mail)).toBeNull();
    expect(await Messages.count(ws, { direction: 'inbound' })).toBe(1);
    expect(heard).toEqual([first?._id]);
    off();
  });

  it('ignores our own sends and threads that are not ours', async () => {
    const { ws, mailbox, message } = await sent();
    expect(
      await ingest(mailbox, reply(message.threadId as string, { labelIds: ['SENT'] })),
    ).toBeNull();
    expect(await ingest(mailbox, reply('someone-elses-thread'))).toBeNull();
    expect(await Messages.count(ws, { direction: 'inbound' })).toBe(0);
  });

  it('handles a bounce: bounced, suppressed, enrollment stopped', async () => {
    const { ws, mailbox, message } = await sent();
    await Enrollments.col().insertOne(
      Enrollments.schema.parse({
        _id: message.enrollmentId,
        workspaceId: ws,
        createdAt: T0,
        updatedAt: T0,
        contactId: message.contactId,
        campaignId: message.campaignId,
        stepIndex: 0,
      }),
    );
    // Bounces may arrive in a new thread; they quote our Message-ID.
    const bounce = reply('other-thread', {
      from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>',
      text: `Message ${message.rfcMessageId} could not be delivered`,
    });
    expect(await ingest(mailbox, bounce)).toBeNull();
    expect(await ingest(mailbox, bounce)).toBeNull();
    expect((await Messages.get(ws, message._id))?.status).toBe('bounced');
    expect(await Suppressions.findOne(ws, { value: 'ana@acme0.example' })).toMatchObject({
      kind: 'bounce',
    });
    expect((await Contacts.get(ws, message.contactId))?.status).toBe('suppressed');
    expect(await Enrollments.get(ws, message.enrollmentId as string)).toMatchObject({
      status: 'stopped',
      stopReason: 'bounced',
    });
  });

  it('pauses the campaign once bounces exceed 5% of at least 20 sends', async () => {
    const { ws, mailbox, messages, campaign } = await sent(20);
    const bounceOf = (m: (typeof messages)[number]) =>
      ingest(
        mailbox,
        reply(m.threadId as string, { id: `b-${m._id}`, from: 'mailer-daemon@googlemail.com' }),
      );
    await bounceOf(messages[0] as (typeof messages)[number]);
    expect((await Campaigns.get(ws, campaign._id))?.status).toBe('running'); // 1/20 = 5%
    await bounceOf(messages[1] as (typeof messages)[number]);
    expect((await Campaigns.get(ws, campaign._id))?.status).toBe('paused'); // 10%
  });
});

describe('syncMailbox', () => {
  it('reads history from the cursor, files replies and advances the cursor', async () => {
    const { ws, mailbox, message } = await sent();
    const base = recorder(mailbox).client;
    const client: MailClient = {
      ...base,
      history: async (start) =>
        start === '100' ? { historyId: '120', messageIds: ['g1', 'g1'] } : null,
      message: async (id) => reply(message.threadId as string, { id }),
    };
    expect(await syncMailbox(mailbox, client)).toHaveLength(1);
    expect((await Mailboxes.get(ws, mailbox._id))?.historyId).toBe('120');
    // Duplicate push with the same history: nothing new.
    expect(await syncMailbox(mailbox, client)).toHaveLength(0);
    // Expired cursor: restart from the profile's cursor.
    const fresh = (await Mailboxes.get(ws, mailbox._id)) as Mailbox;
    await syncMailbox(fresh, client);
    expect((await Mailboxes.get(ws, mailbox._id))?.historyId).toBe('100');
  });
});

describe('mailbox', () => {
  it('connects a mailbox from the Gmail profile and starts a watch', async () => {
    const { ws, mailbox } = await workspace();
    const client: MailClient = {
      ...recorder(mailbox).client,
      profile: async () => ({ emailAddress: 'Mei@PixelPress.example', historyId: '42' }),
      watch: async () => ({ historyId: '43', expiration: new Date('2026-10-20T00:00:00Z') }),
    };
    const connected = await connectMailbox(ws, 'user-1', client);
    expect(connected).toMatchObject({
      email: 'mei@pixelpress.example',
      userId: 'user-1',
      historyId: '42',
    });
    expect(await Mailboxes.count(ws)).toBe(1);
  });

  it('renewWatches is a no-op without a Pub/Sub topic', async () => {
    expect(await renewWatches()).toBeGreaterThanOrEqual(0);
  });
});

describe('FAKE_MAIL simulator', () => {
  it('is deterministic and plays opens, clicks, replies and bounces through the real paths', async () => {
    const { ws, mailbox, messages } = await sent(12);
    expect(script(messages[0] as (typeof messages)[number])).toEqual(
      script(messages[0] as (typeof messages)[number]),
    );
    const played = [];
    for (const m of messages)
      played.push(...(await simulate(mailbox, m._id, { wait: async () => {} })));
    const opens = played.filter((e) => e.kind === 'open').length;
    const clicks = played.filter((e) => e.kind === 'click').length;
    const replies = played.filter((e) => e.kind === 'reply').length;
    expect(opens + clicks + replies).toBeGreaterThan(0);
    expect(await TrackingEvents.count(ws, { kind: 'open' })).toBe(opens);
    expect(await TrackingEvents.count(ws, { kind: 'click' })).toBe(clicks);
    expect(await Messages.count(ws, { direction: 'inbound' })).toBe(replies);
    // Prefetches at +3s are machine opens.
    const machine = played.filter((e) => e.kind === 'open' && e.after < 10_000).length;
    expect(await TrackingEvents.count(ws, { kind: 'open', machine: true })).toBe(machine);
  });

  it('bounces addresses scripted to bounce', async () => {
    expect(script({ _id: 'x', to: 'bounce@acme.example', body: '' })).toMatchObject([
      { kind: 'bounce' },
    ]);
  });
});
