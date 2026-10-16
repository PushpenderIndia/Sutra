import { describe, expect, it } from 'vitest';
import { Messages, Replies, TrackingEvents } from './collections.ts';
import { newId } from './repository.ts';
import { metricsFor, variantMetrics } from './stats.ts';

const sent = (ws: string, variantId: string, status: 'sent' | 'bounced') =>
  Messages.create(ws, {
    contactId: newId(),
    variantId,
    direction: 'outbound',
    status,
    subject: 's',
    body: 'b',
    idempotencyKey: newId(),
  });

const track = (
  ws: string,
  variantId: string,
  kind: 'open' | 'click' | 'unsubscribe',
  machine = false,
) => TrackingEvents.create(ws, { messageId: newId(), variantId, kind, machine, at: new Date() });

const reply = (ws: string, variantId: string, intent: 'interested' | 'objection') =>
  Replies.create(ws, {
    messageId: newId(),
    contactId: newId(),
    variantId,
    intent,
    sentiment: intent === 'interested' ? 'positive' : 'negative',
    language: 'en',
    summaryEn: 's',
    at: new Date(),
  });

describe('variantMetrics', () => {
  it('aggregates sends, bounces, human opens, clicks, replies and positive replies per variant', async () => {
    const ws = newId();
    const a = newId();
    const b = newId();

    await Promise.all([
      sent(ws, a, 'sent'),
      sent(ws, a, 'sent'),
      sent(ws, a, 'sent'),
      sent(ws, a, 'bounced'),
      sent(ws, b, 'sent'),
    ]);
    await Promise.all([
      track(ws, a, 'open', false),
      track(ws, a, 'open', true), // machine open — excluded
      track(ws, a, 'click', false),
      track(ws, a, 'unsubscribe'),
    ]);
    await Promise.all([
      reply(ws, a, 'interested'),
      reply(ws, a, 'objection'),
      reply(ws, b, 'interested'),
    ]);

    const map = await variantMetrics(ws);
    expect(metricsFor(map, a)).toEqual({
      sent: 3,
      delivered: 3,
      opens: 1, // machine open excluded
      clicks: 1,
      replies: 2,
      positiveReplies: 1, // only the "interested" reply
      unsubscribes: 1,
      bounces: 1,
    });
    expect(metricsFor(map, b).sent).toBe(1);
    expect(metricsFor(map, b).positiveReplies).toBe(1);
  });

  it('scopes to the workspace and returns all-zero metrics for an unknown variant', async () => {
    const ws = newId();
    const other = newId();
    await sent(other, newId(), 'sent'); // a different workspace's data must not leak
    const map = await variantMetrics(ws);
    expect(map.size).toBe(0);
    expect(metricsFor(map, newId())).toMatchObject({ sent: 0, replies: 0, positiveReplies: 0 });
  });
});
