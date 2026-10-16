import { AuditEvents, Messages, migrate } from '@sutra/db';
import { messageTransitions } from '@sutra/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { headersOf, recorder, T0, workspace } from '../test/fixtures.ts';
import { sendReply } from './reply-send.ts';

beforeAll(() => migrate());

/** A sent inbound-then-draft conversation; returns the draft reply awaiting approval. */
async function withDraft() {
  const { ws, mailbox, contact, queue } = await workspace();
  if (!contact) throw new Error('fixture has no contact');
  const sent = await queue(); // an earlier outbound in the thread
  await Messages.transition(ws, sent._id, 'queued', 'sent', messageTransitions);
  await Messages.update(ws, sent._id, {
    threadId: 'thread-1',
    rfcMessageId: '<orig@pixelpress.example>',
  });
  const draft = await Messages.create(ws, {
    contactId: contact._id,
    direction: 'outbound',
    status: 'draft',
    to: contact.email,
    subject: 'Re: Packaging for Acme',
    body: 'Thanks! Here are a few times that work.',
    threadId: 'thread-1',
    idempotencyKey: `reply-draft:${sent._id}`,
  });
  return { ws, mailbox, draft };
}

describe('sendReply', () => {
  it('sends an approved draft, threads it and marks it sent', async () => {
    const { ws, mailbox, draft } = await withDraft();
    const { client, sent } = recorder(mailbox);

    const result = await sendReply(ws, draft._id, { now: T0, client });
    expect(result?.status).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.threadId).toBe('thread-1');
    const h = headersOf(sent[0]?.raw ?? '');
    expect(h['in-reply-to']).toBe('<orig@pixelpress.example>');

    const stored = await Messages.get(ws, draft._id);
    expect(stored?.status).toBe('sent');
    expect(stored?.sentAt).toEqual(T0);

    const audits = await AuditEvents.find(ws, { action: 'reply.sent' });
    expect(audits).toHaveLength(1);
  });

  it('is idempotent: a second approval does not send twice', async () => {
    const { ws, mailbox, draft } = await withDraft();
    const { client, sent } = recorder(mailbox);
    await sendReply(ws, draft._id, { now: T0, client });
    const again = await sendReply(ws, draft._id, { now: T0, client });
    expect(again).toBeNull();
    expect(sent).toHaveLength(1);
  });
});
