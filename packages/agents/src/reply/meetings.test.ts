import {
  Companies,
  Contacts,
  Enrollments,
  Mailboxes,
  Meetings,
  migrate,
  newId,
  WorkspaceSettings,
} from '@sutra/db';
import { fakeCalendarClient } from '@sutra/mail';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ReplyDeps } from './deps.ts';
import { bookMeeting, checkAvailability } from './meetings.ts';

const AT = new Date('2026-10-19T00:00:00Z');
beforeAll(() => migrate());

const deps = (busy: { start: Date; end: Date }[] = []): ReplyDeps => ({
  analyzer: {
    analyze: async () => ({ intent: 'other', sentiment: 'neutral', language: 'en', summaryEn: '' }),
  },
  calendarFor: () => fakeCalendarClient(busy),
});

async function setup(status: 'contacted' | 'interested' = 'interested') {
  const ws = newId();
  await WorkspaceSettings.create(ws, {
    senderName: 'Mei',
    homeCountry: 'JP',
    timezone: 'Asia/Tokyo',
    businessHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    warmup: {},
  });
  await Mailboxes.create(ws, {
    userId: 'fake',
    email: `mei-${ws.slice(-6)}@mailbox.example`,
    historyId: '1',
  });
  const company = await Companies.create(ws, {
    name: 'Acme',
    normalizedName: 'acme',
    country: 'JP',
    sources: [{ source: 'search', ref: 'q', at: AT }],
  });
  const contact = await Contacts.create(ws, {
    companyId: company._id,
    email: 'ana@acme.example',
    emailConfidence: 'verified',
    locale: 'ja',
    timezone: 'Asia/Tokyo',
    status,
  });
  const enrollment = await Enrollments.create(ws, {
    contactId: contact._id,
    campaignId: newId(),
    stepIndex: 0,
    status: 'active',
    assignedVariants: {},
  });
  return { ws, contact, enrollment };
}

describe('checkAvailability', () => {
  it('returns free business-hour slots in the contact time zone', async () => {
    const { ws, contact } = await setup();
    const slots = await checkAvailability({
      workspaceId: ws,
      contactId: contact._id,
      now: AT,
      deps: deps(),
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(3);
  });
});

describe('bookMeeting', () => {
  it('creates an event, records the meeting, flips status and stops the sequence', async () => {
    const { ws, contact, enrollment } = await setup();
    const start = new Date('2026-10-20T05:00:00Z'); // 14:00 JST
    const end = new Date('2026-10-20T05:30:00Z');

    const meeting = await bookMeeting({
      workspaceId: ws,
      contactId: contact._id,
      start,
      end,
      deps: deps(),
    });
    expect(meeting?.meetUrl).toMatch(/meet\.google\.com/);
    expect(meeting?.calendarEventId).toBeTruthy();

    expect(await Meetings.count(ws, { contactId: contact._id })).toBe(1);
    expect((await Contacts.get(ws, contact._id))?.status).toBe('meeting_booked');
    const enr = await Enrollments.get(ws, enrollment._id);
    expect(enr?.status).toBe('stopped');
    expect(enr?.stopReason).toBe('meeting_booked');
  });

  it('is idempotent: a contact who already has a meeting is not double-booked', async () => {
    const { ws, contact } = await setup();
    const start = new Date('2026-10-20T05:00:00Z');
    const end = new Date('2026-10-20T05:30:00Z');
    const first = await bookMeeting({
      workspaceId: ws,
      contactId: contact._id,
      start,
      end,
      deps: deps(),
    });
    const second = await bookMeeting({
      workspaceId: ws,
      contactId: contact._id,
      start,
      end,
      deps: deps(),
    });
    expect(second?._id).toBe(first?._id);
    expect(await Meetings.count(ws, { contactId: contact._id })).toBe(1);
  });
});
