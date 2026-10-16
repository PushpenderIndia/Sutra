import { DAY, mailboxCap, nextOpen, packFor, type SendWindow } from '@sutra/compliance';
import type { Country, WorkspaceSettings } from '@sutra/domain';

/** The send window a contact's sends must fall in: its country pack, with the workspace overrides. */
export const windowFor = (
  country: Country,
  overrides: WorkspaceSettings['complianceOverrides'] = {},
): SendWindow => packFor(country, overrides).sendWindow;

/** `from` if it already falls inside the window, else the next time the window opens (contact tz). */
export const sendSlot = (from: Date, window: SendWindow, timezone: string): Date =>
  nextOpen(from, window, timezone) ?? from;

/**
 * When to run a step scheduled `delayDays` after `from`, aligned to the contact's send window: a
 * step that would fall at 22:00 on a Friday lands at the next business-day opening instead.
 */
export const scheduleStep = (
  from: Date,
  delayDays: number,
  window: SendWindow,
  timezone: string,
): Date => sendSlot(new Date(from.getTime() + delayDays * DAY), window, timezone);

/** The mailbox warm-up quota for the next `horizon` days: "20 today, 25 tomorrow …". */
export const warmupRamp = (
  workspace: Parameters<typeof mailboxCap>[0],
  startDay: number,
  horizon = 5,
): { day: number; cap: number }[] =>
  Array.from({ length: Math.max(0, horizon) }, (_, i) => ({
    day: startDay + i,
    cap: mailboxCap(workspace, startDay + i),
  }));

export interface TimezoneSends {
  timezone: string;
  count: number;
  /** When the window first opens for this group at or after `now`. */
  first: Date;
}

/**
 * Checkpoint 2's schedule preview: for each distinct contact time zone, how many contacts and when
 * their window next opens. The UI formats `first` in each zone ("Jakarta 09:12 WIB, Tokyo 09:05 JST").
 */
export function firstSendsByTimezone(
  contacts: readonly { timezone: string; country: Country }[],
  now: Date,
  overrides: WorkspaceSettings['complianceOverrides'] = {},
): TimezoneSends[] {
  const groups = new Map<string, { count: number; first: Date }>();
  for (const c of contacts) {
    const first = sendSlot(now, windowFor(c.country, overrides), c.timezone);
    const existing = groups.get(c.timezone);
    if (existing) {
      existing.count += 1;
      if (first.getTime() < existing.first.getTime()) existing.first = first;
    } else {
      groups.set(c.timezone, { count: 1, first });
    }
  }
  return [...groups.entries()]
    .map(([timezone, g]) => ({ timezone, count: g.count, first: g.first }))
    .sort((a, b) => a.first.getTime() - b.first.getTime());
}

export { DAY };
