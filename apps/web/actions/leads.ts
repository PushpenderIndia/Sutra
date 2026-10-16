'use server';
import { bookMeeting, checkAvailability } from '@sutra/agents';
import { audit, Messages } from '@sutra/db';
import { id, messageTransitions } from '@sutra/domain';
import { sendReply } from '@sutra/mail';
import { z } from 'zod';
import { AppError, action } from '@/lib/action';

/** Loads a contact's pending reply draft, or fails if it is gone (already sent, discarded). */
async function pendingDraft(workspaceId: string, messageId: string) {
  const draft = await Messages.get(workspaceId, messageId);
  if (draft?.direction !== 'outbound' || draft.status !== 'draft')
    throw new AppError('NOT_FOUND', 'That reply draft is no longer pending');
  return draft;
}

/**
 * Approves a drafted reply and sends it. Nothing is ever sent until a person approves — there is no
 * auto-reply. Idempotent: a second approval of an already-sent draft is a no-op.
 */
export const approveReplyDraft = action(
  z.object({ messageId: id }),
  async ({ workspaceId, user }, { messageId }) => {
    await pendingDraft(workspaceId, messageId);
    const sent = await sendReply(workspaceId, messageId);
    await audit(workspaceId, { kind: 'user', id: user.id }, 'reply.approved', {
      entity: 'message',
      entityId: messageId,
    });
    return { ok: true as const, sent: Boolean(sent) };
  },
);

/** Edits a drafted reply before approval (the subject and/or body). It stays a draft. */
export const editReplyDraft = action(
  z.object({ messageId: id, subject: z.string().max(200).optional(), body: z.string().min(1) }),
  async ({ workspaceId, user }, { messageId, subject, body }) => {
    await pendingDraft(workspaceId, messageId);
    await Messages.update(workspaceId, messageId, { body, ...(subject && { subject }) });
    await audit(workspaceId, { kind: 'user', id: user.id }, 'reply.draft_edit', {
      entity: 'message',
      entityId: messageId,
    });
    return { ok: true as const };
  },
);

/** Discards a drafted reply without sending it. */
export const discardReplyDraft = action(
  z.object({ messageId: id }),
  async ({ workspaceId, user }, { messageId }) => {
    await pendingDraft(workspaceId, messageId);
    await Messages.transition(workspaceId, messageId, 'draft', 'cancelled', messageTransitions);
    await audit(workspaceId, { kind: 'user', id: user.id }, 'reply.draft_discard', {
      entity: 'message',
      entityId: messageId,
    });
    return { ok: true as const };
  },
);

/**
 * Books the first available slot for a lead: proposes free times (contact time zone, business hours,
 * free/busy) and books one, creating a calendar event with a Meet link and moving the contact to
 * "meeting booked". Also exposed to the chat copilot via the `book_meeting` tool (PR 16).
 */
export const bookSuggestedMeeting = action(
  z.object({ contactId: id }),
  async ({ workspaceId, user }, { contactId }) => {
    const [slot] = await checkAvailability({ workspaceId, contactId, count: 1 });
    if (!slot) throw new AppError('INVALID', 'No free meeting slots were found');
    const meeting = await bookMeeting({
      workspaceId,
      contactId,
      start: slot.start,
      end: slot.end,
      actor: { kind: 'user', id: user.id },
    });
    if (!meeting) throw new AppError('NOT_FOUND', 'That contact no longer exists');
    return {
      ok: true as const,
      startsAt: meeting.startsAt.toISOString(),
      meetUrl: meeting.meetUrl,
    };
  },
);
