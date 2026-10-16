import type { AllowDecision } from '@sutra/compliance';
import {
  type ApprovedVariant,
  AuditEvents,
  Campaigns,
  Messages,
  migrate,
  variantHash,
} from '@sutra/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { headersOf, later, MINUTE, recorder, T0, workspace } from '../test/fixtures.ts';
import { deliver, GAP_MS, nextSlot, send } from './send.ts';

beforeAll(() => migrate());

describe('deliver', () => {
  it('sends a queued message with compliance footer, List-Unsubscribe and tracking', async () => {
    const { ws, mailbox, queue } = await workspace();
    const { client, sent } = recorder(mailbox);
    const message = await queue();
    const result = await deliver(ws, message._id, { now: T0, client });
    expect(result.status).toBe('sent');
    const stored = await Messages.get(ws, message._id);
    expect(stored).toMatchObject({
      status: 'sent',
      sentAt: T0,
      from: mailbox.email,
      gmailId: sent[0]?.id,
      threadId: sent[0]?.thread,
      rfcMessageId: `<${message._id}@pixelpress.example>`,
    });
    expect(stored?.sendingAt).toBeUndefined();
    const raw = sent[0]?.raw ?? '';
    const h = headersOf(raw);
    expect(h['list-unsubscribe']).toMatch(
      /^<http:\/\/localhost:3000\/u\/[^>]+\/one-click>, <mailto:mei\.[a-f0-9]+@pixelpress\.example\?subject=unsubscribe>$/,
    );
    expect(h['list-unsubscribe-post']).toBe('List-Unsubscribe=One-Click');
    expect(h.from).toBe(`Mei Tan <${mailbox.email}>`);
    expect(raw).toContain('/t/o/');
    expect(raw).toContain('/t/c/');
    expect(raw).toContain('1 Demo Street');
    const audits = await AuditEvents.find(ws, {
      action: { $in: ['mail.sent', 'compliance.check'] },
    });
    expect(audits.map((a) => a.action).sort()).toEqual(['compliance.check', 'mail.sent']);
  });

  it('is idempotent: a retried or concurrent delivery sends once', async () => {
    const { ws, mailbox, queue } = await workspace();
    const { client, sent } = recorder(mailbox);
    const message = await queue();
    const results = await Promise.all([
      deliver(ws, message._id, { now: T0, client }),
      deliver(ws, message._id, { now: T0, client }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['sent', 'skipped']);
    expect(await deliver(ws, message._id, { now: later(30), client })).toEqual({
      status: 'skipped',
      reason: 'sent',
    });
    expect(sent).toHaveLength(1);
  });

  it('threads follow-ups: same Gmail thread, Re: subject, In-Reply-To and References', async () => {
    const { ws, mailbox, queue } = await workspace();
    const { client, sent } = recorder(mailbox);
    const first = await queue(0, 0);
    await deliver(ws, first._id, { now: T0, client });
    const second = await queue(0, 1, { subject: 'Close the loop?' });
    expect((await deliver(ws, second._id, { now: later(60), client })).status).toBe('sent');
    const [a, b] = sent;
    expect(b?.threadId).toBe(a?.thread);
    const h = headersOf(b?.raw ?? '');
    expect(h.subject).toBe('Re: Packaging for Acme');
    expect(h['in-reply-to']).toBe(`<${first._id}@pixelpress.example>`);
    expect(h.references).toBe(`<${first._id}@pixelpress.example>`);
    expect((await Messages.get(ws, second._id))?.threadId).toBe(a?.thread);
  });

  it('refuses unapproved or edited variants and cancels the message', async () => {
    const { ws, mailbox, queue, campaign, variant } = await workspace();
    const { client, sent } = recorder(mailbox);
    // Edited after approval: the stored hash no longer matches.
    const edited = { ...variant, body: `${variant.body} P.S.`, approvedHash: variantHash(variant) };
    await Campaigns.update(ws, campaign._id, {
      steps: [{ delayDays: 0, variants: [edited] }],
    });
    const message = await queue();
    expect(await deliver(ws, message._id, { now: T0, client })).toEqual({
      status: 'blocked',
      reasons: ['not_approved'],
    });
    expect((await Messages.get(ws, message._id))?.status).toBe('cancelled');
    expect(sent).toHaveLength(0);
  });

  it('defers outside the send window and when the last send was under 2 minutes ago', async () => {
    const { ws, mailbox, queue } = await workspace(2);
    const { client } = recorder(mailbox);
    const night = await queue(0);
    const result = await deliver(ws, night._id, { now: new Date('2026-10-13T14:00:00Z'), client });
    expect(result).toMatchObject({ status: 'deferred', reasons: ['outside_send_window'] });
    expect((await Messages.get(ws, night._id))?.status).toBe('queued');

    await deliver(ws, night._id, { now: T0, client });
    const next = await queue(1);
    const spaced = await deliver(ws, next._id, { now: later(1), client, random: () => 0.5 });
    expect(spaced).toEqual({
      status: 'deferred',
      retryAt: nextSlot(T0, () => 0.5),
      reasons: ['spacing'],
    });
  });

  it('day 1 of warm-up never sends more than startPerDay', async () => {
    const { ws, mailbox, queue } = await workspace(25, { startPerDay: 20 });
    const { client, sent } = recorder(mailbox);
    const statuses: string[] = [];
    for (let i = 0; i < 25; i++) {
      const m = await queue(i);
      statuses.push((await deliver(ws, m._id, { now: later(i * 10), client })).status);
    }
    expect(sent).toHaveLength(20);
    expect(statuses.filter((s) => s === 'deferred')).toHaveLength(5);
  });

  it('marks the message failed when the transport throws', async () => {
    const { ws, mailbox, queue } = await workspace();
    const { client } = recorder(mailbox);
    const message = await queue();
    const broken = { ...client, send: async () => Promise.reject(new Error('Gmail 500')) };
    expect(await deliver(ws, message._id, { now: T0, client: broken })).toEqual({
      status: 'failed',
      error: 'Gmail 500',
    });
    expect(await Messages.get(ws, message._id)).toMatchObject({
      status: 'failed',
      error: 'Gmail 500',
    });
  });

  it('blocks bodies with too many links or URL shorteners', async () => {
    const { ws, mailbox, queue, campaign, variant } = await workspace();
    const body = 'a https://bit.ly/x';
    const v = { ...variant, body };
    await Campaigns.update(ws, campaign._id, {
      steps: [{ delayDays: 0, variants: [{ ...v, approvedHash: variantHash(v) }] }],
    });
    const message = await queue(0, 0, { body });
    const result = await deliver(ws, message._id, { now: T0, client: recorder(mailbox).client });
    expect(result).toEqual({ status: 'blocked', reasons: ['URL shortener: https://bit.ly/x'] });
  });
});

describe('send() permits', () => {
  it('requires an AllowDecision and an ApprovedVariant by type', () => {
    const message = {} as Parameters<typeof send>[0];
    const allow = {} as AllowDecision;
    const approval = {} as ApprovedVariant;
    const typeOnly = () => {
      // @ts-expect-error: a plain object is not a compliance permit
      void send(message, { allow: true, requirements: [], pack: 'SG', packVersion: '1' }, approval);
      // @ts-expect-error: a plain object is not an approval permit
      void send(message, allow, { campaignId: 'x', variantId: 'y', hash: 'z' });
      // @ts-expect-error: both permits are required
      void send(message);
    };
    expect(typeof typeOnly).toBe('function');
  });

  it('nextSlot spaces sends 2–9 minutes apart', () => {
    expect(nextSlot(T0, () => 0).getTime() - T0.getTime()).toBe(GAP_MS.min);
    expect(nextSlot(T0, () => 0.999).getTime() - T0.getTime()).toBeLessThan(9 * MINUTE);
  });
});
