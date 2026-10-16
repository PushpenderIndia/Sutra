import { createHash } from 'node:crypto';
import { Messages, newId } from '@sutra/db';
import type { Mailbox, Message } from '@sutra/domain';
import type { MailClient } from './gmail.ts';
import { linksIn } from './render.ts';
import { ingest } from './sync.ts';
import { recordEvent } from './tracking.ts';

/**
 * `FAKE_MAIL=true` (demo mode): a transport that "delivers" instantly and then plays a scripted,
 * deterministic reaction for each message (opens, a prefetch, clicks, replies, bounces) through
 * the same code paths real tracking hits and Gmail replies take.
 */

export type ScriptedEvent =
  | { after: number; kind: 'open'; userAgent: string; ip: string }
  | { after: number; kind: 'click'; url: string; userAgent: string; ip: string }
  | { after: number; kind: 'reply' | 'bounce'; text: string };

const REPLIES = [
  'Thanks for reaching out. Could you share pricing for about 2,000 units a month?',
  'Interesting. Can we talk next Tuesday afternoon?',
  'Not right now, maybe next quarter.',
  'We already have a supplier, thanks.',
  'Please remove me from your list.',
];
const HUMAN =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const SECOND = 1000;

/** Deterministic randoms in [0, 1) from the message id, so a demo replays the same way. */
function dice(seed: string) {
  const bytes = createHash('sha256').update(seed).digest();
  let i = 0;
  return () => bytes.readUInt32BE((i++ % 8) * 4) / 2 ** 32;
}

/** What the simulated recipient of `message` does, and when (ms after sending). */
export function script(message: Pick<Message, '_id' | 'to' | 'body'>): ScriptedEvent[] {
  const roll = dice(message._id);
  if (/^bounce/i.test(message.to ?? ''))
    return [{ after: 5 * SECOND, kind: 'bounce', text: `Delivery to ${message.to} failed.` }];
  const events: ScriptedEvent[] = [];
  const ip = `203.0.113.${Math.floor(roll() * 250) + 1}`;
  if (roll() < 0.3)
    events.push({ after: 3 * SECOND, kind: 'open', userAgent: 'GoogleImageProxy', ip });
  if (roll() < 0.6)
    events.push({ after: (15 + roll() * 45) * SECOND, kind: 'open', userAgent: HUMAN, ip });
  const [url] = linksIn(message.body);
  if (url && roll() < 0.25)
    events.push({ after: (30 + roll() * 60) * SECOND, kind: 'click', url, userAgent: HUMAN, ip });
  if (roll() < 0.25) {
    const text = REPLIES[Math.floor(roll() * REPLIES.length)] as string;
    events.push({ after: (45 + roll() * 75) * SECOND, kind: 'reply', text });
  }
  return events.sort((a, b) => a.after - b.after);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

/** Plays `script(message)` against the database. `wait` is injectable so tests run instantly. */
export async function simulate(mailbox: Mailbox, messageId: string, { wait = sleep } = {}) {
  const at = (m: Message, after: number) => new Date((m.sentAt?.getTime() ?? Date.now()) + after);
  let elapsed = 0;
  const initial = await Messages.get(mailbox.workspaceId, messageId);
  if (!initial) return [];
  const events = script(initial);
  for (const event of events) {
    await wait(event.after - elapsed);
    elapsed = event.after;
    const message = await Messages.get(mailbox.workspaceId, messageId);
    if (!message?.threadId) return events;
    if (event.kind === 'open' || event.kind === 'click')
      await recordEvent(message, event.kind, { ...event, at: at(message, event.after) });
    else
      await ingest(mailbox, {
        id: `fake-${event.kind}-${message._id}`,
        threadId: message.threadId,
        labelIds: ['INBOX'],
        headers: {},
        from:
          event.kind === 'bounce'
            ? 'Mail Delivery Subsystem <mailer-daemon@mailbox.example>'
            : (message.to ?? ''),
        subject:
          event.kind === 'bounce'
            ? 'Delivery Status Notification (Failure)'
            : `Re: ${message.subject}`,
        text: event.text,
      });
  }
  return events;
}

/** The simulated transport. Each send schedules `simulate()` in the background. */
export function fakeClient(mailbox: Mailbox, { autoplay = true } = {}): MailClient {
  return {
    profile: async () => ({ emailAddress: mailbox.email, historyId: mailbox.historyId ?? '1' }),
    async send(raw, threadId) {
      const id = `fake-${newId()}`;
      const messageId = raw.toString('utf8').match(/^Message-ID: <([a-f0-9]{24})@/im)?.[1];
      if (autoplay && messageId)
        void simulate(mailbox, messageId).catch((e) => console.error('FAKE_MAIL simulation', e));
      return { id, threadId: threadId ?? `fake-thread-${newId()}` };
    },
    watch: async () => ({
      historyId: mailbox.historyId ?? '1',
      expiration: new Date(Date.now() + 7 * 86_400_000),
    }),
    history: async (startHistoryId) => ({ historyId: startHistoryId, messageIds: [] }),
    message: async (id) => {
      throw new Error(`FAKE_MAIL has no message ${id}`);
    },
  };
}
