import type { SendWindow } from './pack.ts';

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

const formats = new Map<string, Intl.DateTimeFormat>();
const format = (timeZone: string) => {
  let f = formats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formats.set(timeZone, f);
  }
  return f;
};

/** The wall-clock date and time at `at` in `timeZone`. */
export function local(at: Date, timeZone: string) {
  const p = Object.fromEntries(
    format(timeZone)
      .formatToParts(at)
      .map(({ type, value }) => [type, Number(value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute', number>;
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    /** 0 = Sunday. */
    weekday: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(),
    minutes: p.hour * 60 + p.minute,
  };
}

const offset = (t: number, timeZone: string) => {
  const l = local(new Date(t), timeZone);
  return Date.UTC(l.year, l.month - 1, l.day, 0, l.minutes) - Math.floor(t / MINUTE) * MINUTE;
};

/** The instant a wall-clock time occurs in `timeZone`; day overflow rolls over (DST-safe). */
export function zoned(year: number, month: number, day: number, minutes: number, tz: string) {
  const guess = Date.UTC(year, month - 1, day, 0, minutes);
  return new Date(guess - offset(guess - offset(guess, tz), tz));
}

/** `HH:MM` → minutes since midnight. */
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Local midnight at the start of the day `at` falls on, plus `days`. */
export function startOfDay(at: Date, timeZone: string, days = 0) {
  const l = local(at, timeZone);
  return zoned(l.year, l.month, l.day + days, 0, timeZone);
}

/** Midnight at the start of the next local day. */
export const nextMidnight = (at: Date, timeZone: string) => startOfDay(at, timeZone, 1);

/** `at` if it falls inside the window in `timeZone`, else when the window next opens. */
export function nextOpen(at: Date, window: SendWindow, timeZone: string): Date | undefined {
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  if (start >= end) return undefined;
  const l = local(at, timeZone);
  if (window.days.includes(l.weekday) && l.minutes >= start && l.minutes < end) return at;
  for (let i = 0; i <= 7; i++) {
    const opens = zoned(l.year, l.month, l.day + i, start, timeZone);
    if (opens > at && window.days.includes(local(opens, timeZone).weekday)) return opens;
  }
  return undefined;
}
