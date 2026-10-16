import { domainOf } from '@sutra/compliance';
import { audit, Messages, WorkspaceSettings } from '@sutra/db';
import { type Actor, type Id, messageTransitions } from '@sutra/domain';
import type { MailClient } from './gmail.ts';
import { clientFor, mailboxFor } from './mailbox.ts';
import { buildMime } from './mime.ts';
import { contentIssues, render } from './render.ts';

const REPLY: Actor = { kind: 'user', id: 'reply' };

export interface SendReplyOptions {
  now?: Date;
  client?: MailClient;
}

/**
 * Sends an approved reply draft (an outbound `draft` message a person approved in the Leads tab):
 * threads it into the contact's existing conversation, marks it sent and audits. Unlike campaign
 * sends there is no variant permit — a human approved this exact text. Returns the sent message,
 * or `null` when the draft was already handled (idempotent for retries/duplicate approvals).
 */
export async function sendReply(
  workspaceId: Id,
  messageId: Id,
  { now = new Date(), client }: SendReplyOptions = {},
) {
  const message = await Messages.get(workspaceId, messageId);
  if (!message) throw new Error(`Message ${messageId} not found`);
  if (message.direction !== 'outbound') throw new Error('Not an outbound message');
  if (!message.to) throw new Error('Message has no recipient');
  const issues = contentIssues(message.body);
  if (issues.length) throw new Error(`Content blocked: ${issues.join('; ')}`);

  // Claim the draft: only the first caller moves it off `draft`.
  const queued = await Messages.transition(
    workspaceId,
    messageId,
    'draft',
    'queued',
    messageTransitions,
  );
  if (!queued) return null;

  const [mailbox, settings] = await Promise.all([
    mailboxFor(workspaceId),
    WorkspaceSettings.findOne(workspaceId, {}),
  ]);
  const transport = client ?? clientFor(mailbox);

  // Thread the reply onto the whole conversation with this contact (both directions).
  const conversation = await Messages.find(
    workspaceId,
    {
      _id: { $ne: messageId },
      contactId: message.contactId,
      rfcMessageId: { $exists: true },
    },
    { sort: { sentAt: 1, createdAt: 1 } },
  );
  const references = conversation.flatMap((m) => m.rfcMessageId ?? []);
  const rfcMessageId = `<${message._id}@${domainOf(mailbox.email)}>`;
  const sender = {
    name: settings?.senderName ?? '',
    title: settings?.senderTitle,
    email: mailbox.email,
  };
  const { text, html } = render({ body: message.body, requirements: [], sender });
  const raw = await buildMime({
    from: { name: sender.name, address: mailbox.email },
    to: message.to,
    subject: message.subject,
    text,
    html,
    messageId: rfcMessageId,
    references,
    date: now,
  });

  try {
    const { id, threadId } = await transport.send(raw, message.threadId);
    const sent = await Messages.transition(
      workspaceId,
      messageId,
      'queued',
      'sent',
      messageTransitions,
      {
        gmailId: id,
        threadId,
        rfcMessageId,
        from: mailbox.email,
        sentAt: now,
        sendingAt: undefined,
      },
    );
    if (!sent) throw new Error(`Reply ${messageId} changed state while sending`);
    await audit(workspaceId, REPLY, 'reply.sent', {
      entity: 'message',
      entityId: messageId,
      data: { gmailId: id, threadId },
    });
    return sent;
  } catch (error) {
    await Messages.transition(workspaceId, messageId, 'queued', 'failed', messageTransitions, {
      error: (error as Error).message,
    });
    throw error;
  }
}
