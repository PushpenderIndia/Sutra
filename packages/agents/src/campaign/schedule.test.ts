import type { SendWindow } from '@sutra/compliance';
import type { WorkspaceSettings } from '@sutra/domain';
import { describe, expect, it } from 'vitest';
import { firstSendsByTimezone, scheduleStep, sendSlot, warmupRamp, windowFor } from './schedule.ts';

const WINDOW: SendWindow = { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] };

/** Wall-clock parts of `d` in `tz`, for asserting the local time a send lands at. */
function wall(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(d)
      .map(({ type, value }) => [type, value]),
  );
  return { weekday: p.weekday, time: `${p.hour}:${p.minute}` };
}

describe('windowFor', () => {
  it('returns a country pack send window', () => {
    const w = windowFor('SG');
    expect(w.start).toMatch(/^\d\d:\d\d$/);
    expect(w.days.length).toBeGreaterThan(0);
  });
});

describe('sendSlot / scheduleStep', () => {
  it('keeps a time already inside the window', () => {
    // Tuesday 13 Oct 2026, 10:00 in Manila (UTC+8).
    const inside = new Date('2026-10-13T02:00:00Z');
    expect(sendSlot(inside, WINDOW, 'Asia/Manila')).toEqual(inside);
  });

  it('a step due at 22:00 in Manila is moved to the next business morning', () => {
    // Tuesday 13 Oct 2026, 22:00 in Manila → next open is Wednesday 09:00.
    const night = new Date('2026-10-13T14:00:00Z');
    const slot = scheduleStep(night, 0, WINDOW, 'Asia/Manila');
    expect(wall(slot, 'Asia/Manila')).toEqual({ weekday: 'Wed', time: '09:00' });
  });

  it('rolls a Friday-evening send to Monday (weekends are closed)', () => {
    // Friday 16 Oct 2026, 22:00 in Manila.
    const friNight = new Date('2026-10-16T14:00:00Z');
    const slot = scheduleStep(friNight, 0, WINDOW, 'Asia/Manila');
    expect(wall(slot, 'Asia/Manila')).toEqual({ weekday: 'Mon', time: '09:00' });
  });

  it('adds the step delay before aligning to the window', () => {
    // Monday 12 Oct 2026, 10:00 Manila + 3 days = Thursday 10:00, which is inside the window.
    const mon = new Date('2026-10-12T02:00:00Z');
    const slot = scheduleStep(mon, 3, WINDOW, 'Asia/Manila');
    expect(wall(slot, 'Asia/Manila')).toEqual({ weekday: 'Thu', time: '10:00' });
  });
});

const workspace = (over: Partial<WorkspaceSettings> = {}): WorkspaceSettings =>
  ({
    senderName: 'Mei',
    physicalAddress: '1 Demo Street',
    timezone: 'Asia/Singapore',
    dailySendCap: 150,
    warmup: { enabled: true, startPerDay: 20, increasePerDay: 5, max: 150 },
    complianceOverrides: {},
    ...over,
  }) as WorkspaceSettings;

describe('warmupRamp', () => {
  it('ramps from the start-of-day cap by the daily increase', () => {
    expect(warmupRamp(workspace(), 0, 3)).toEqual([
      { day: 0, cap: 20 },
      { day: 1, cap: 25 },
      { day: 2, cap: 30 },
    ]);
  });

  it('never exceeds the daily send cap', () => {
    const ramp = warmupRamp(workspace({ dailySendCap: 22 }), 0, 3);
    expect(ramp.map((r) => r.cap)).toEqual([20, 22, 22]);
  });
});

describe('firstSendsByTimezone', () => {
  it('groups contacts by time zone and sorts by first opening', () => {
    // Sunday 11 Oct 2026, 02:00 UTC: Jakarta (UTC+7) and Tokyo (UTC+9) both open Monday.
    const now = new Date('2026-10-11T02:00:00Z');
    const groups = firstSendsByTimezone(
      [
        { timezone: 'Asia/Jakarta', country: 'ID' },
        { timezone: 'Asia/Jakarta', country: 'ID' },
        { timezone: 'Asia/Tokyo', country: 'JP' },
      ],
      now,
    );
    expect(groups.map((g) => ({ tz: g.timezone, count: g.count }))).toEqual([
      { tz: 'Asia/Tokyo', count: 1 },
      { tz: 'Asia/Jakarta', count: 2 },
    ]);
    // Tokyo opens before Jakarta in absolute time (its morning is earlier in UTC).
    expect(groups[0]?.first.getTime()).toBeLessThan(groups[1]?.first.getTime() ?? 0);
  });
});
