import { describe, expect, it, vi } from 'vitest';
import { fakeCalendarClient, googleCalendarClient } from './calendar.ts';

describe('fakeCalendarClient', () => {
  it('returns no busy intervals by default and deterministic events with a Meet link', async () => {
    const cal = fakeCalendarClient();
    expect(await cal.freeBusy(new Date(), new Date(Date.now() + 86_400_000))).toEqual([]);
    const event = await cal.insertEvent({
      summary: 'x',
      start: new Date('2026-10-20T05:00:00Z'),
      end: new Date('2026-10-20T05:30:00Z'),
      timezone: 'Asia/Tokyo',
      attendees: ['a@b.com'],
    });
    expect(event.meetUrl).toMatch(/meet\.google\.com/);
    expect(event.id).toBeTruthy();
  });

  it('filters configured busy intervals to the window', async () => {
    const busy = [
      { start: new Date('2026-10-20T05:00:00Z'), end: new Date('2026-10-20T06:00:00Z') },
    ];
    const cal = fakeCalendarClient(busy);
    expect(
      await cal.freeBusy(new Date('2026-10-20T00:00:00Z'), new Date('2026-10-21T00:00:00Z')),
    ).toHaveLength(1);
    expect(
      await cal.freeBusy(new Date('2026-10-22T00:00:00Z'), new Date('2026-10-23T00:00:00Z')),
    ).toHaveLength(0);
  });
});

describe('googleCalendarClient', () => {
  const token = async () => 'tok';
  const asFetch = (m: unknown) => m as unknown as typeof globalThis.fetch;

  it('parses free/busy into intervals', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            calendars: {
              primary: { busy: [{ start: '2026-10-20T05:00:00Z', end: '2026-10-20T05:30:00Z' }] },
            },
          }),
          { status: 200 },
        ),
    );
    const cal = googleCalendarClient(token, asFetch(fetchMock));
    const busy = await cal.freeBusy(
      new Date('2026-10-20T00:00:00Z'),
      new Date('2026-10-21T00:00:00Z'),
    );
    expect(busy).toEqual([
      { start: new Date('2026-10-20T05:00:00Z'), end: new Date('2026-10-20T05:30:00Z') },
    ]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('creates an event with a Meet conference request and returns the link', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: 'evt1', hangoutLink: 'https://meet.google.com/abc-defg-hij' }),
          { status: 200 },
        ),
    );
    const cal = googleCalendarClient(token, asFetch(fetchMock));
    const event = await cal.insertEvent({
      summary: 'Intro',
      start: new Date('2026-10-20T05:00:00Z'),
      end: new Date('2026-10-20T05:30:00Z'),
      timezone: 'Asia/Tokyo',
      attendees: ['ana@acme.example'],
    });
    expect(event).toMatchObject({ id: 'evt1', meetUrl: 'https://meet.google.com/abc-defg-hij' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/calendars/primary/events?conferenceDataVersion=1');
    const body = JSON.parse(init.body as string);
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe('hangoutsMeet');
    expect(body.attendees).toEqual([{ email: 'ana@acme.example' }]);
  });

  it('throws on a non-OK response', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 403 }));
    const cal = googleCalendarClient(token, asFetch(fetchMock));
    await expect(cal.freeBusy(new Date(), new Date())).rejects.toThrow(/Calendar/);
  });
});
