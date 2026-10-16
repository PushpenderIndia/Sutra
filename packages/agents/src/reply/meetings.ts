import { audit, Contacts, Enrollments, Meetings, WorkspaceSettings } from '@sutra/db';
import {
  type Actor,
  canTransition,
  contactTransitions,
  type Id,
  type Meeting,
} from '@sutra/domain';
import { type Interval, mailboxFor } from '@sutra/mail';
import { type ReplyDeps, replyDeps } from './deps.ts';
import { type BusinessHours, offerSlots } from './slots.ts';

const DEFAULT_HOURS: BusinessHours = { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] };
const MEETING_DURATION_MINS = 30;
/** How far ahead free/busy is queried when proposing slots. */
const LOOKAHEAD_DAYS = 14;

const AGENT: Actor = { kind: 'agent', id: 'replyAnalyst' };

export interface CheckAvailabilityInput {
  workspaceId: Id;
  contactId: Id;
  now?: Date;
  /** Windows the contact asked for (from the reply analysis); slots stay inside these. */
  preferred?: readonly Interval[];
  count?: number;
  deps?: ReplyDeps;
}

/**
 * Proposes up to `count` free meeting slots in the contact's time zone, inside the workspace's
 * business hours, avoiding the sender's busy calendar. Reused by the reply analyst (to draft
 * "offer slots" replies) and the chat copilot's `checkAvailability` tool.
 */
export async function checkAvailability({
  workspaceId,
  contactId,
  now = new Date(),
  preferred,
  count = 3,
  deps = replyDeps(),
}: CheckAvailabilityInput): Promise<Interval[]> {
  const [contact, settings, mailbox] = await Promise.all([
    Contacts.get(workspaceId, contactId),
    WorkspaceSettings.findOne(workspaceId, {}),
    mailboxFor(workspaceId),
  ]);
  if (!contact) return [];
  const timezone = contact.timezone ?? settings?.timezone ?? 'UTC';
  const businessHours = settings?.businessHours ?? DEFAULT_HOURS;
  const calendar = deps.calendarFor(mailbox);

  const timeMax = new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000);
  const busy = await calendar.freeBusy(now, timeMax).catch(() => [] as Interval[]);
  return offerSlots({
    now,
    timezone,
    businessHours,
    busy,
    preferred,
    count,
    durationMins: MEETING_DURATION_MINS,
    horizonDays: LOOKAHEAD_DAYS,
  });
}

export interface BookMeetingInput {
  workspaceId: Id;
  contactId: Id;
  start: Date;
  end: Date;
  summary?: string;
  description?: string;
  actor?: Actor;
  deps?: ReplyDeps;
}

/**
 * Books a meeting: creates a Google Calendar event with a Meet link, records the `meetings` doc,
 * moves the contact to `meeting_booked` and stops the sequence. Idempotent: a contact who already
 * has a meeting is returned as-is rather than double-booked. Audited.
 */
export async function bookMeeting({
  workspaceId,
  contactId,
  start,
  end,
  summary,
  description,
  actor = AGENT,
  deps = replyDeps(),
}: BookMeetingInput): Promise<Meeting | null> {
  const contact = await Contacts.get(workspaceId, contactId);
  if (!contact) return null;

  const existing = await Meetings.findOne(workspaceId, { contactId });
  if (existing) return existing;

  const [settings, mailbox] = await Promise.all([
    WorkspaceSettings.findOne(workspaceId, {}),
    mailboxFor(workspaceId),
  ]);
  const timezone = contact.timezone ?? settings?.timezone ?? 'UTC';
  const calendar = deps.calendarFor(mailbox);

  const event = await calendar.insertEvent({
    summary:
      summary ?? `Meeting: ${settings?.senderName ?? 'Sutra'} ↔ ${contact.name ?? contact.email}`,
    description,
    start,
    end,
    timezone,
    attendees: [contact.email, mailbox.email],
  });

  const meeting = await Meetings.create(workspaceId, {
    contactId,
    startsAt: start,
    endsAt: end,
    timezone,
    calendarEventId: event.id,
    meetUrl: event.meetUrl,
  });

  if (canTransition(contactTransitions, contact.status, 'meeting_booked'))
    await Contacts.transition(
      workspaceId,
      contactId,
      contact.status,
      'meeting_booked',
      contactTransitions,
    );

  await Enrollments.col().updateMany(
    { workspaceId, contactId, status: { $in: ['active', 'paused'] } },
    { $set: { status: 'stopped', stopReason: 'meeting_booked', updatedAt: new Date() } },
  );

  await audit(workspaceId, actor, 'meeting.booked', {
    entity: 'meeting',
    entityId: meeting._id,
    data: { contactId, calendarEventId: event.id, startsAt: start.toISOString() },
  });
  return meeting;
}
