import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceSettings } from './collections.ts';
import { isDemoMode } from './demo.ts';
import { migrate } from './migrate.ts';
import { newId } from './repository.ts';

const base = {
  senderName: 'Mei Tan',
  homeCountry: 'SG',
  timezone: 'Asia/Singapore',
  businessHours: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
  warmup: {},
};

beforeEach(() => migrate());

describe('isDemoMode', () => {
  it('defaults to demo when a workspace has no settings', async () => {
    expect(await isDemoMode(newId())).toBe(true);
  });

  it('defaults to demo when settings omit the flag', async () => {
    const ws = newId();
    await WorkspaceSettings.create(ws, base);
    expect(await isDemoMode(ws)).toBe(true);
  });

  it('reflects the stored flag once set to live', async () => {
    const ws = newId();
    await WorkspaceSettings.create(ws, { ...base, demoMode: false });
    expect(await isDemoMode(ws)).toBe(false);
  });
});
