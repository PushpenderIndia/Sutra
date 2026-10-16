import { describe, expect, it } from 'vitest';
import { company, contact, country, id, timezone, workspaceSettings } from './index.ts';

const base = {
  _id: 'a'.repeat(24),
  workspaceId: 'b'.repeat(24),
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('domain schemas', () => {
  it('validates ids, countries and time zones', () => {
    expect(id.safeParse('64656d6f0000000000000001').success).toBe(true);
    expect(id.safeParse('xyz').success).toBe(false);
    expect(country.safeParse('SG').success).toBe(true);
    expect(country.safeParse('sg').success).toBe(false);
    expect(timezone.safeParse('Asia/Jakarta').success).toBe(true);
    expect(timezone.safeParse('Mars/Olympus').success).toBe(false);
  });

  it('applies defaults and normalises emails', () => {
    const c = contact.parse({
      ...base,
      companyId: 'c'.repeat(24),
      email: 'Ayu@Kopi.Example',
      emailConfidence: 'pattern',
      locale: 'id',
      timezone: 'Asia/Jakarta',
    });
    expect(c).toMatchObject({ email: 'ayu@kopi.example', status: 'new' });

    const co = company.parse({
      ...base,
      name: 'Kopi',
      normalizedName: 'kopi',
      country: 'ID',
      sources: [{ source: 'places', ref: 'place/1', at: new Date() }],
    });
    expect(co).toMatchObject({ status: 'new', scoreReasons: [] });
    expect(company.safeParse({ ...co, sources: [] }).success).toBe(false);
  });

  it('fills warm-up defaults', () => {
    const s = workspaceSettings.parse({
      ...base,
      senderName: 'Mei',
      homeCountry: 'SG',
      timezone: 'Asia/Singapore',
      businessHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
      warmup: {},
    });
    expect(s.warmup).toEqual({ enabled: true, startPerDay: 20, increasePerDay: 5, max: 150 });
    expect(s.dailySendCap).toBe(150);
  });
});
