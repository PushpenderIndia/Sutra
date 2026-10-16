import { describe, expect, it } from 'vitest';
import { offerSlots, partsInZone, zonedTimeToUtc } from './slots.ts';

const TOKYO = 'Asia/Tokyo';
const HOURS = { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] };

describe('zonedTimeToUtc / partsInZone', () => {
  it('round-trips a wall-clock time in a zone', () => {
    // 2026-10-20 14:00 in Tokyo (UTC+9) is 05:00 UTC.
    const utc = zonedTimeToUtc(2026, 10, 20, 14, 0, TOKYO);
    expect(utc.toISOString()).toBe('2026-10-20T05:00:00.000Z');
    const p = partsInZone(utc, TOKYO);
    expect(p).toMatchObject({ year: 2026, month: 10, day: 20, hour: 14, minute: 0, weekday: 2 });
  });
});

describe('offerSlots — preferred window (acceptance: Tuesday afternoon in Asia/Tokyo)', () => {
  const now = zonedTimeToUtc(2026, 10, 19, 0, 0, TOKYO); // Monday
  const preferred = [
    {
      start: zonedTimeToUtc(2026, 10, 20, 13, 0, TOKYO),
      end: zonedTimeToUtc(2026, 10, 20, 17, 0, TOKYO),
    },
  ];

  it('offers three 30-minute slots on Tuesday afternoon in the contact time zone', () => {
    const slots = offerSlots({ now, timezone: TOKYO, businessHours: HOURS, preferred });
    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      const p = partsInZone(slot.start, TOKYO);
      expect(p.weekday).toBe(2); // Tuesday
      expect(p.hour).toBeGreaterThanOrEqual(12); // afternoon
      expect(p.hour).toBeLessThan(18);
      expect(slot.end.getTime() - slot.start.getTime()).toBe(30 * 60_000);
    }
    const first = slots[0];
    expect(first && partsInZone(first.start, TOKYO).hour).toBe(13);
  });

  it('skips busy intervals from the calendar', () => {
    const busy = [
      {
        start: zonedTimeToUtc(2026, 10, 20, 13, 0, TOKYO),
        end: zonedTimeToUtc(2026, 10, 20, 14, 0, TOKYO),
      },
    ];
    const slots = offerSlots({ now, timezone: TOKYO, businessHours: HOURS, preferred, busy });
    const first = slots[0];
    expect(first && partsInZone(first.start, TOKYO).hour).toBe(14); // 13:00 and 13:30 are busy
  });
});

describe('offerSlots — no preferred window', () => {
  it('proposes business-hour slots on upcoming weekdays only', () => {
    const now = zonedTimeToUtc(2026, 10, 17, 10, 0, TOKYO); // Saturday
    const slots = offerSlots({ now, timezone: TOKYO, businessHours: HOURS, count: 2 });
    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      const p = partsInZone(slot.start, TOKYO);
      expect(HOURS.days).toContain(p.weekday); // never a weekend
      expect(p.hour).toBeGreaterThanOrEqual(9);
      expect(p.hour).toBeLessThan(18);
      expect(slot.start.getTime()).toBeGreaterThanOrEqual(now.getTime());
    }
  });
});
