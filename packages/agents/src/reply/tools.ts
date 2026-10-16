import { FunctionTool } from '@google/adk';
import type { Id } from '@sutra/domain';
import { z } from 'zod';
import { bookMeeting, checkAvailability } from './meetings.ts';

/**
 * ADK `FunctionTool`s that expose meeting scheduling to the chat copilot (PR 16). Each is bound to a
 * workspace, so the model never supplies `workspaceId`; it only names the contact and the time. The
 * deterministic slot proposal and booking live in {@link checkAvailability} / {@link bookMeeting}.
 */

/** Proposes free meeting slots for a contact. Read-only. */
export const checkAvailabilityTool = (workspaceId: Id): FunctionTool =>
  new FunctionTool({
    name: 'check_availability',
    description:
      "Proposes up to a few free meeting slots (ISO-8601) for a contact, in their time zone and inside business hours, avoiding the sender's busy calendar.",
    parameters: z.object({
      contactId: z.string().describe('The contact id to propose meeting times for.'),
      count: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe('How many slots to propose (default 3).'),
    }),
    execute: async ({ contactId, count }) => {
      const slots = await checkAvailability({ workspaceId, contactId, count });
      return {
        slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
      };
    },
  });

/** Books a meeting at a chosen time. Mutating → requires the user's confirmation in chat. */
export const bookMeetingTool = (workspaceId: Id): FunctionTool =>
  new FunctionTool({
    name: 'book_meeting',
    description:
      'Books a meeting with a contact at a chosen time: creates a calendar event with a Google Meet link, moves the contact to "meeting booked" and stops the sequence.',
    parameters: z.object({
      contactId: z.string().describe('The contact id to book the meeting with.'),
      start: z.string().describe('Meeting start, ISO-8601 with the correct offset.'),
      end: z.string().describe('Meeting end, ISO-8601 with the correct offset.'),
    }),
    requireConfirmation: true,
    execute: async ({ contactId, start, end }) => {
      const meeting = await bookMeeting({
        workspaceId,
        contactId,
        start: new Date(start),
        end: new Date(end),
        actor: { kind: 'user', id: 'chat' },
      });
      if (!meeting) return { booked: false, reason: 'contact not found' };
      return {
        booked: true,
        startsAt: meeting.startsAt.toISOString(),
        meetUrl: meeting.meetUrl,
      };
    },
  });

/** Both meeting tools, bound to one workspace, for the chat agent. */
export const meetingTools = (workspaceId: Id): FunctionTool[] => [
  checkAvailabilityTool(workspaceId),
  bookMeetingTool(workspaceId),
];
