import { type AllowDecision, domainOf } from '@sutra/compliance';
import {
  type ApprovedVariant,
  approvedVariant,
  audit,
  type CheckFor,
  checkFor,
  Messages,
  unsubscribeLinks,
  WorkspaceSettings,
} from '@sutra/db';
import { type Actor, type Id, type Message, messageTransitions } from '@sutra/domain';
import type { MailClient } from './gmail.ts';
import { clientFor, mailboxFor } from './mailbox.ts';
import { buildMime } from './mime.ts';
import { contentIssues, render } from './render.ts';
import { trackingFor } from './tracking.ts';

const SENDER: Actor = { kind: 'system', id: 'mail' };
const MINUTE = 60_000;
/** Sends are spaced by a random 2–9 minute gap, never sent in bursts. */
export const GAP_MS = { min: 2 * MINUTE, max: 9 * MINUTE };
/** A claim older than this is presumed dead (the worker crashed) and may be retaken. */
const CLAIM_TTL_MS = 15 * MINUTE;

/** The next jittered send slot after `previous`. */
export const nextSlot = (previous: Date, random = Math.random) =>
  new Date(previous.getTime() + GAP_MS.min + Math.floor(random() * (GAP_MS.max - GAP_MS.min)));

const stripRe = (subject: string) => subject.replace(/^(\s*re:\s*)+/i, '');

/** Earlier sent messages of the same sequence for this contact, oldest first. */
const threadOf = (message: Message) =>
  Messages.find(
    message.workspaceId,
    {
      _id: { $ne: message._id },
      contactId: message.contactId,
      direction: 'outbound',
      status: { $in: ['sent', 'bounced'] },
      ...(message.enrollmentId
        ? { enrollmentId: message.enrollmentId }
        : { campaignId: message.campaignId }),
    },
    { sort: { sentAt: 1 } },
  );

export interface SendOptions {
  now?: Date;
  /** Defaults to the workspace mailbox's transport. */
  client?: MailClient;
}

/**
 * Sends one queued message from the workspace mailbox. Both permits are required by type:
 * `decision` (only `check()` creates an `AllowDecision`) and `approval` (only
 * `approvedVariant()` creates an `ApprovedVariant`). Applies the compliance requirements
 * (footer, sender identity, address, `List-Unsubscribe`), threads follow-ups, tracks opens and
 * clicks, then marks the message sent and audits. Prefer `deliver()`, which obtains both permits.
 */
export async function send(
  message: Message,
  decision: AllowDecision,
  approval: ApprovedVariant,
  { now = new Date(), client }: SendOptions = {},
) {
  if (message.variantId !== approval.variantId || message.campaignId !== approval.campaignId)
    throw new Error('The approval is for another variant');
  if (!message.to) throw new Error('Message has no recipient');
  const issues = contentIssues(message.body);
  if (issues.length) throw new Error(`Content blocked: ${issues.join('; ')}`);

  const ws = message.workspaceId;
  const [mailbox, settings, thread] = await Promise.all([
    mailboxFor(ws),
    WorkspaceSettings.findOne(ws, {}),
    threadOf(message),
  ]);
  const transport = client ?? clientFor(mailbox);
  const root = thread[0];
  // Gmail threads a reply only with the same subject and its References.
  const subject = root ? `Re: ${stripRe(root.subject)}` : message.subject;
  const references = thread.flatMap((m) => m.rfcMessageId ?? []);
  const rfcMessageId = `<${message._id}@${domainOf(mailbox.email)}>`;
  const { requirements } = decision;
  const unsubscribe = unsubscribeLinks(ws, message.contactId);
  const sender = {
    name: settings?.senderName ?? '',
    title: settings?.senderTitle,
    email: mailbox.email,
    physicalAddress: settings?.physicalAddress,
  };
  const { text, html } = render({
    body: message.body,
    requirements,
    sender,
    unsubscribeUrl: unsubscribe.page,
    track: trackingFor(ws, message._id),
  });
  const raw = await buildMime({
    from: { name: sender.name, address: mailbox.email },
    to: message.to,
    subject,
    text,
    html,
    messageId: rfcMessageId,
    references,
    date: now,
    ...(requirements.includes('list_unsubscribe_header') && {
      unsubscribe: {
        oneClick: unsubscribe.oneClick,
        mailto: `mailto:${mailbox.email}?subject=unsubscribe`,
      },
    }),
  });

  const { id, threadId } = await transport.send(raw, root?.threadId);
  const sent = await Messages.transition(ws, message._id, 'queued', 'sent', messageTransitions, {
    gmailId: id,
    threadId,
    rfcMessageId,
    from: mailbox.email,
    subject,
    sentAt: now,
    sendingAt: undefined,
  });
  if (!sent) throw new Error(`Message ${message._id} changed state while sending`);
  await audit(ws, SENDER, 'mail.sent', {
    entity: 'message',
    entityId: message._id,
    data: { gmailId: id, threadId, followUp: !!root, pack: decision.pack },
  });
  return sent;
}

export type DeliverResult =
  | { status: 'sent'; message: Message }
  /** Temporarily blocked (send window, caps, warm-up, spacing): run `deliver` again at `retryAt`. */
  | { status: 'deferred'; retryAt: Date; reasons: string[] }
  /** Permanently blocked or not approved: the message is cancelled. */
  | { status: 'blocked'; reasons: string[] }
  | { status: 'failed'; error: string }
  /** Not queued (already sent, cancelled) or another worker is sending it: nothing to do. */
  | { status: 'skipped'; reason: string };

export interface DeliverOptions extends SendOptions {
  /** Injectable compliance lookup (tests). */
  checkFor?: CheckFor;
  random?: () => number;
}

/**
 * The one send path, safe to retry: queued message → spacing → `checkFor()` → approval →
 * claim → `send()`. A retried job or duplicate task for a sent message is a no-op.
 */
export async function deliver(
  workspaceId: Id,
  messageId: Id,
  { now = new Date(), client, checkFor: check = checkFor, random }: DeliverOptions = {},
): Promise<DeliverResult> {
  const message = await Messages.get(workspaceId, messageId);
  if (!message) throw new Error(`Message ${messageId} not found`);
  if (message.direction !== 'outbound' || message.status !== 'queued')
    return { status: 'skipped', reason: message.status };

  const defer = async (retryAt: Date, reasons: string[]) => {
    await Messages.update(workspaceId, messageId, { scheduledAt: retryAt });
    return { status: 'deferred', retryAt, reasons } as const;
  };
  const cancel = async (reasons: string[]) => {
    await Messages.transition(workspaceId, messageId, 'queued', 'cancelled', messageTransitions, {
      error: reasons.join('; '),
    });
    await audit(workspaceId, SENDER, 'mail.blocked', {
      entity: 'message',
      entityId: messageId,
      data: { reasons },
    });
    return { status: 'blocked', reasons } as const;
  };

  const [last] = await Messages.find(
    workspaceId,
    { direction: 'outbound', sentAt: { $exists: true } },
    { sort: { sentAt: -1 }, limit: 1, projection: { sentAt: 1 } },
  );
  if (last?.sentAt && now.getTime() - last.sentAt.getTime() < GAP_MS.min)
    return defer(nextSlot(last.sentAt, random), ['spacing']);

  const decision = await check(workspaceId, message.contactId, { at: now, actor: SENDER });
  if (!decision.allow) {
    const codes = decision.reasons.map((r) => r.code);
    return decision.retryAt ? defer(decision.retryAt, codes) : cancel(codes);
  }
  const approval =
    message.campaignId && message.variantId
      ? await approvedVariant(workspaceId, message.campaignId, message.variantId)
      : null;
  if (!approval) return cancel(['not_approved']);
  const issues = contentIssues(message.body);
  if (issues.length) return cancel(issues);

  const claimed = await Messages.col().findOneAndUpdate(
    {
      workspaceId,
      _id: messageId,
      status: 'queued',
      $or: [
        { sendingAt: { $exists: false } },
        { sendingAt: { $lt: new Date(now.getTime() - CLAIM_TTL_MS) } },
      ],
    },
    { $set: { sendingAt: now } },
    { returnDocument: 'after' },
  );
  if (!claimed) return { status: 'skipped', reason: 'in_flight' };

  try {
    const sent = await send(claimed, decision, approval, { now, client });
    return { status: 'sent', message: sent };
  } catch (e) {
    const error = (e as Error).message;
    await Messages.transition(workspaceId, messageId, 'queued', 'failed', messageTransitions, {
      error,
      sendingAt: undefined,
    });
    await audit(workspaceId, SENDER, 'mail.failed', {
      entity: 'message',
      entityId: messageId,
      data: { error },
    });
    return { status: 'failed', error };
  }
}
