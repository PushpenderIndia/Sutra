import { env } from '@sutra/config';
import type { Mailbox } from '@sutra/domain';
import { accessToken, GoogleApiError } from './gmail.ts';
import { googleRefreshToken } from './mailbox.ts';

/**
 * A minimal Google Calendar REST client over `fetch` (no `googleapis`): the two calls Sutra needs
 * — free/busy lookup and creating an event with a Google Meet link — behind an interface with a
 * fake, so the reply analyst and chat copilot can offer and book meetings without a network.
 */

export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/** A half-open time interval. */
export interface Interval {
  start: Date;
  end: Date;
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  /** IANA time zone the event is shown in (the attendee's). */
  timezone: string;
  attendees: string[];
}

export interface CalendarEvent {
  id: string;
  /** The Google Meet link created with the event. */
  meetUrl: string;
  htmlLink?: string;
}

/** The calendar transport. `googleCalendarClient()` talks to Google; `fakeCalendarClient()` simulates it. */
export interface CalendarClient {
  /** Busy intervals on the primary calendar between `timeMin` and `timeMax`. */
  freeBusy(timeMin: Date, timeMax: Date): Promise<Interval[]>;
  /** Creates an event on the primary calendar with a Google Meet link; returns its id and link. */
  insertEvent(event: CalendarEventInput): Promise<CalendarEvent>;
}

type Fetch = typeof fetch;

/** A Google Calendar client for the mailbox whose access token `token()` returns. */
export function googleCalendarClient(
  token: () => Promise<string>,
  f: Fetch = fetch,
): CalendarClient {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await f(`${CALENDAR_API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await token()}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (!res.ok)
      throw new GoogleApiError(res.status, `Calendar ${path.split('?')[0]}: ${await res.text()}`);
    return (await res.json()) as T;
  }
  const post = <T>(path: string, body: unknown) =>
    call<T>(path, { method: 'POST', body: JSON.stringify(body) });

  return {
    async freeBusy(timeMin, timeMax) {
      const body = await post<{
        calendars?: { primary?: { busy?: { start: string; end: string }[] } };
      }>('/freeBusy', {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: 'primary' }],
      });
      return (body.calendars?.primary?.busy ?? []).map((b) => ({
        start: new Date(b.start),
        end: new Date(b.end),
      }));
    },
    async insertEvent(event) {
      const requestId = `sutra-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const body = await post<{ id: string; hangoutLink?: string; htmlLink?: string }>(
        '/calendars/primary/events?conferenceDataVersion=1',
        {
          summary: event.summary,
          description: event.description,
          start: { dateTime: event.start.toISOString(), timeZone: event.timezone },
          end: { dateTime: event.end.toISOString(), timeZone: event.timezone },
          attendees: event.attendees.map((email) => ({ email })),
          conferenceData: {
            createRequest: {
              requestId,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        },
      );
      return {
        id: body.id,
        meetUrl: body.hangoutLink ?? `https://meet.google.com/lookup/${body.id}`,
        htmlLink: body.htmlLink,
      };
    },
  };
}

/**
 * A {@link CalendarClient} for tests and `FAKE_MAIL` demo mode: no busy intervals by default
 * (configurable), and deterministic fake events with a Meet link. No network.
 */
export function fakeCalendarClient(busy: Interval[] = []): CalendarClient {
  let n = 0;
  return {
    freeBusy: async (timeMin, timeMax) =>
      busy.filter((b) => b.end > timeMin && b.start < timeMax).map((b) => ({ ...b })),
    insertEvent: async () => {
      n += 1;
      const id = `fake-event-${n}`;
      return {
        id,
        meetUrl: `https://meet.google.com/fake-${n}`,
        htmlLink: `https://calendar.google.com/${id}`,
      };
    },
  };
}

/** The calendar for a workspace mailbox: the simulator in `FAKE_MAIL` mode, Google otherwise. */
export function calendarFor(mailbox: Mailbox): CalendarClient {
  if (env.FAKE_MAIL || mailbox.userId === 'fake') return fakeCalendarClient();
  return googleCalendarClient(async () => {
    const refreshToken = await googleRefreshToken(mailbox.workspaceId, mailbox.userId);
    if (!refreshToken) throw new GoogleApiError(401, 'Mailbox disconnected: connect it again');
    return accessToken(refreshToken, { cacheKey: `${mailbox.workspaceId}:${mailbox.userId}:cal` });
  });
}
