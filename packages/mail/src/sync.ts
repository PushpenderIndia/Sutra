import { emailHash, normalizeEmail } from '@sutra/compliance';
import {
  audit,
  Campaigns,
  Contacts,
  Enrollments,
  Mailboxes,
  Messages,
  Suppressions,
} from '@sutra/db';
import {
  type Actor,
  campaignTransitions,
  type Mailbox,
  type Message,
  messageTransitions,
} from '@sutra/domain';
import { MongoServerError } from 'mongodb';
import type { InboundMail, MailClient } from './gmail.ts';
import { clientFor } from './mailbox.ts';

const SYNC: Actor = { kind: 'system', id: 'mail.sync' };
/** A campaign pauses once bounces exceed this share of its sends (after `MIN_SENDS`). */
export const BOUNCE_LIMIT = 0.05;
const MIN_SENDS = 20;

type ReplyListener = (reply: Message) => unknown;
const listeners = new Set<ReplyListener>();

/** Subscribes to new replies (from Gmail push or the simulator); returns an unsubscribe. */
export function onReply(listener: ReplyListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const addressOf = (from: string) => normalizeEmail(from.match(/<([^>]+)>/)?.[1] ?? from);
const isBounce = (from: string) => /mailer-daemon|postmaster/i.test(from);
/** Our `Message-ID` is `<messageId@domain>`; bounces quote it. */
const OUR_ID = /<([a-f0-9]{24})@[^>\s]+>/;

async function original(mailbox: Mailbox, mail: InboundMail) {
  const ws = mailbox.workspaceId;
  const [inThread] = await Messages.find(
    ws,
    { threadId: mail.threadId, direction: 'outbound', sentAt: { $exists: true } },
    { sort: { sentAt: -1 }, limit: 1 },
  );
  if (inThread) return inThread;
  const quoted = `${mail.headers['in-reply-to'] ?? ''} ${mail.headers.references ?? ''} ${mail.text}`;
  const id = quoted.match(OUR_ID)?.[1];
  const message = id ? await Messages.get(ws, id) : null;
  return message?.direction === 'outbound' ? message : null;
}

/** Bounce → message bounced, address suppressed, enrollment stopped; pause on a high bounce rate. */
async function bounce(message: Message, mail: InboundMail) {
  const ws = message.workspaceId;
  const moved = await Messages.transition(ws, message._id, 'sent', 'bounced', messageTransitions);
  if (!moved) return; // already handled (duplicate push)
  if (message.to)
    await Suppressions.upsertBy(ws, 'value', {
      kind: 'bounce',
      scope: 'email',
      value: normalizeEmail(message.to),
      reason: `bounce: ${mail.subject}`.slice(0, 200),
      at: new Date(),
    });
  await Contacts.col().updateOne(
    { workspaceId: ws, _id: message.contactId },
    { $set: { status: 'suppressed', updatedAt: new Date() } },
  );
  if (message.enrollmentId)
    await Enrollments.col().updateOne(
      { workspaceId: ws, _id: message.enrollmentId, status: { $in: ['active', 'paused'] } },
      { $set: { status: 'stopped', stopReason: 'bounced', updatedAt: new Date() } },
    );
  await audit(ws, SYNC, 'mail.bounced', {
    entity: 'message',
    entityId: message._id,
    data: { emailHash: message.to && emailHash(message.to) },
  });
  if (!message.campaignId) return;
  const byCampaign = { campaignId: message.campaignId, direction: 'outbound' as const };
  const [sent, bounced] = await Promise.all([
    Messages.count(ws, { ...byCampaign, status: { $in: ['sent', 'bounced'] } }),
    Messages.count(ws, { ...byCampaign, status: 'bounced' }),
  ]);
  if (sent >= MIN_SENDS && bounced / sent > BOUNCE_LIMIT) {
    const paused = await Campaigns.transition(
      ws,
      message.campaignId,
      'running',
      'paused',
      campaignTransitions,
    );
    if (paused)
      await audit(ws, SYNC, 'campaign.paused', {
        entity: 'campaign',
        entityId: message.campaignId,
        data: { reason: 'bounce_rate', sent, bounced },
      });
  }
}

/**
 * Files one inbound Gmail message: a bounce updates the original send; a reply in one of our
 * threads is stored as an inbound message (once: the idempotency key is the Gmail id) and
 * announced to `onReply` listeners. Returns the new reply, or `null`.
 */
export async function ingest(mailbox: Mailbox, mail: InboundMail): Promise<Message | null> {
  if (mail.labelIds.includes('SENT') || addressOf(mail.from) === mailbox.email) return null;
  const sent = await original(mailbox, mail);
  if (!sent) return null; // not one of our threads
  if (isBounce(mail.from)) {
    await bounce(sent, mail);
    return null;
  }
  let reply: Message;
  try {
    reply = await Messages.create(mailbox.workspaceId, {
      contactId: sent.contactId,
      campaignId: sent.campaignId,
      enrollmentId: sent.enrollmentId,
      stepIndex: sent.stepIndex,
      variantId: sent.variantId,
      direction: 'inbound',
      status: 'received',
      from: addressOf(mail.from),
      to: mailbox.email,
      subject: mail.subject,
      body: mail.text,
      gmailId: mail.id,
      threadId: mail.threadId,
      rfcMessageId: mail.headers['message-id'],
      idempotencyKey: `gmail:${mailbox.email}:${mail.id}`,
    });
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) return null; // duplicate delivery
    throw e;
  }
  await audit(mailbox.workspaceId, SYNC, 'mail.reply_received', {
    entity: 'message',
    entityId: reply._id,
    data: { inReplyTo: sent._id, variantId: sent.variantId },
  });
  for (const listener of listeners) await Promise.resolve(listener(reply)).catch(console.error);
  return reply;
}

const newer = (a: string, b?: string) => !b || BigInt(a) > BigInt(b);

/** Reads every inbox message since the mailbox's cursor, files it, and advances the cursor. */
export async function syncMailbox(mailbox: Mailbox, client: MailClient = clientFor(mailbox)) {
  const set = (historyId: string) =>
    Mailboxes.update(mailbox.workspaceId, mailbox._id, { historyId });
  if (!mailbox.historyId) {
    await set((await client.profile()).historyId);
    return [];
  }
  const changes = await client.history(mailbox.historyId);
  if (!changes) {
    // Cursor older than Gmail keeps (about a week): restart from now.
    await set((await client.profile()).historyId);
    return [];
  }
  const replies: Message[] = [];
  for (const id of changes.messageIds) {
    const reply = await ingest(mailbox, await client.message(id));
    if (reply) replies.push(reply);
  }
  const current = await Mailboxes.get(mailbox.workspaceId, mailbox._id);
  if (newer(changes.historyId, current?.historyId)) await set(changes.historyId);
  return replies;
}

/** Handles a Gmail push (`{ emailAddress, historyId }` from Pub/Sub) for any workspace. */
export async function onGmailPush(notification: { emailAddress: string; historyId?: string }) {
  const mailbox = await Mailboxes.col().findOne({
    email: normalizeEmail(notification.emailAddress),
  });
  return mailbox ? syncMailbox(mailbox) : [];
}
