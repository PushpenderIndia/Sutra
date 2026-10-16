import { describe, expect, it } from 'vitest';
import { acquireModelSlot, rpmLimits } from './rate-limit.ts';

describe('acquireModelSlot', () => {
  it('parses the limits spec', () => {
    expect(rpmLimits('sutra-fast=15,sutra-smart=10')).toEqual({
      'sutra-fast': 15,
      'sutra-smart': 10,
    });
  });

  it('waits for the next window once the cap is used', async () => {
    let t = 120_000 * 1000 + 59_000; // one second before a window ends
    const waits: number[] = [];
    const opts = {
      rpm: 2,
      now: () => t,
      wait: async (ms: number) => {
        waits.push(ms);
        t += ms;
      },
    };
    await acquireModelSlot('m', opts);
    await acquireModelSlot('m', opts);
    expect(waits).toEqual([]);
    await acquireModelSlot('m', opts);
    expect(waits).toEqual([1_000]);
    await acquireModelSlot('other', opts);
    expect(waits).toHaveLength(1);
  });
});
