import type { Interval } from '@sutra/mail';

/**
 * Deterministic meeting-slot proposal in the contact's time zone. Pure (no I/O, no clock beyond the
 * `now` passed in), so the "Tuesday afternoon in Asia/Tokyo" acceptance case is a unit test.
 *
 * The LLM understands the reply ("next Tuesday afternoon"); this code turns that into concrete,
 * conflict-free slots inside business hours. The model never picks the actual times.
 */

export interface BusinessHours {
  /** `HH:MM`, 24-hour, in the contact's time zone. */
  start: string;
  end: string;
  /** Weekdays meetings may fall on, 0 = Sunday … 6 = Saturday. */
  days: number[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Wall-clock fields of an instant in a given IANA time zone. */
export function partsInZone(date: Date, timezone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday ?? 'Sun'),
  };
}

/** The UTC offset (local − UTC, ms) that `timezone` has at the given instant. */
function offsetMs(date: Date, timezone: string): number {
  const p = partsInZone(date, timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** The instant for a wall-clock time in `timezone` (handles DST with a one-step correction). */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = offsetMs(new Date(guess), timezone);
  let ts = guess - first;
  const second = offsetMs(new Date(ts), timezone);
  if (second !== first) ts = guess - second;
  return new Date(ts);
}

const toMinutes = (hhmm: string) => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

const overlapsBusy = (start: Date, end: Date, busy: readonly Interval[]) =>
  busy.some((b) => b.start < end && start < b.end);

export interface OfferSlotsInput {
  now: Date;
  timezone: string;
  businessHours: BusinessHours;
  /** Busy intervals from the sender's calendar (free/busy). */
  busy?: readonly Interval[];
  /** Windows the contact asked for (e.g. "next Tuesday afternoon"); slots stay inside these. */
  preferred?: readonly Interval[];
  count?: number;
  durationMins?: number;
  /** How many days ahead to look when no preferred window is given. */
  horizonDays?: number;
}

/**
 * Up to `count` free, business-hours slots in the contact's time zone. When `preferred` windows are
 * given, slots are drawn only from those windows (intersected with business hours); otherwise the
 * next business days from `now`. Busy intervals and past times are skipped.
 */
export function offerSlots({
  now,
  timezone,
  businessHours,
  busy = [],
  preferred,
  count = 3,
  durationMins = 30,
  horizonDays = 14,
}: OfferSlotsInput): Interval[] {
  const dayStart = toMinutes(businessHours.start);
  const dayEnd = toMinutes(businessHours.end);
  const days = new Set(businessHours.days);
  const slots: Interval[] = [];

  /** Adds free slots on one calendar day (in `timezone`), inside [fromMin, toMin). */
  const fillDay = (year: number, month: number, day: number, fromMin: number, toMin: number) => {
    // Confirm the weekday in the target zone, then step through the window.
    const weekday = partsInZone(
      zonedTimeToUtc(year, month, day, 12, 0, timezone),
      timezone,
    ).weekday;
    if (!days.has(weekday)) return;
    for (let m = fromMin; m + durationMins <= toMin && slots.length < count; m += durationMins) {
      const start = zonedTimeToUtc(year, month, day, Math.floor(m / 60), m % 60, timezone);
      const end = new Date(start.getTime() + durationMins * 60_000);
      if (start < now || overlapsBusy(start, end, busy)) continue;
      slots.push({ start, end });
    }
  };

  if (preferred?.length) {
    for (const window of preferred) {
      if (slots.length >= count) break;
      const p = partsInZone(window.start, timezone);
      const endParts = partsInZone(window.end, timezone);
      // Only single-day preferred windows are honoured intra-day; multi-day windows use the start day.
      const fromMin = Math.max(dayStart, p.hour * 60 + p.minute);
      const sameDay =
        p.year === endParts.year && p.month === endParts.month && p.day === endParts.day;
      const toMin = Math.min(dayEnd, sameDay ? endParts.hour * 60 + endParts.minute : dayEnd);
      fillDay(p.year, p.month, p.day, fromMin, toMin);
    }
    return slots;
  }

  const today = partsInZone(now, timezone);
  for (let offset = 0; offset < horizonDays && slots.length < count; offset++) {
    // Advance the calendar day in-zone by building noon `offset` days out.
    const base = zonedTimeToUtc(today.year, today.month, today.day, 12, 0, timezone);
    const d = partsInZone(new Date(base.getTime() + offset * 86_400_000), timezone);
    fillDay(d.year, d.month, d.day, dayStart, dayEnd);
  }
  return slots;
}
