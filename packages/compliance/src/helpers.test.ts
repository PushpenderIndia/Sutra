import { describe, expect, it } from 'vitest';
import { SG, VN } from '../packs/index.ts';
import { domainOf, domainsOf, emailHash, isPersonalEmail } from './address.ts';
import { check, type Decision } from './check.ts';
import { isStale, statusOf, summarize } from './report.ts';
import { DAY, local, nextMidnight, nextOpen, startOfDay, zoned } from './time.ts';

describe('addresses', () => {
  it.each([
    ['ana@gmail.com', true],
    ['ana@GoogleMail.com', true],
    ['budi@yahoo.co.id', true],
    ['som@hotmail.co.th', true],
    ['ken@outlook.jp', true],
    ['jo@live.com', true],
    ['mei@singnet.com.sg', true],
    ['ana@acme.example', false],
    ['ana@yahoo-partners.com', false],
    ['ana@outlook.acme.com', false],
  ])('%s personal: %s', (email, personal) => {
    expect(isPersonalEmail(email)).toBe(personal);
  });

  it('extracts and expands domains', () => {
    expect(domainOf(' Ana@Mail.ACME.example ')).toBe('mail.acme.example');
    expect(domainsOf('a.b.acme.example')).toEqual([
      'a.b.acme.example',
      'b.acme.example',
      'acme.example',
    ]);
  });

  it('hashes normalised addresses', () => {
    expect(emailHash(' Ana@Acme.Example')).toBe(emailHash('ana@acme.example'));
    expect(emailHash('ana@acme.example')).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('time', () => {
  it('reads wall-clock time in a zone', () => {
    expect(local(new Date('2026-10-13T02:30:00Z'), 'Asia/Kolkata')).toEqual({
      year: 2026,
      month: 10,
      day: 13,
      weekday: 2,
      minutes: 8 * 60,
    });
  });

  it('converts wall-clock time to an instant across DST', () => {
    expect(zoned(2026, 10, 5, 9 * 60, 'Australia/Sydney').toISOString()).toBe(
      '2026-10-04T22:00:00.000Z',
    );
    expect(zoned(2026, 9, 28, 9 * 60, 'Australia/Sydney').toISOString()).toBe(
      '2026-09-27T23:00:00.000Z',
    );
    // Day overflow rolls into the next month.
    expect(zoned(2026, 10, 32, 0, 'Asia/Singapore').toISOString()).toBe('2026-10-31T16:00:00.000Z');
  });

  it('finds the next local midnight, including on a 23-hour day', () => {
    expect(startOfDay(new Date('2026-10-13T02:00:00Z'), 'Asia/Singapore').toISOString()).toBe(
      '2026-10-12T16:00:00.000Z',
    );
    expect(nextMidnight(new Date('2026-10-13T02:00:00Z'), 'Asia/Singapore').toISOString()).toBe(
      '2026-10-13T16:00:00.000Z',
    );
    // Sydney, Sunday 4 Oct 2026 has 23 hours: midnight after it is 00:00 AEDT (UTC+11).
    expect(nextMidnight(new Date('2026-10-04T01:00:00Z'), 'Australia/Sydney').toISOString()).toBe(
      '2026-10-04T13:00:00.000Z',
    );
  });

  it('has no next opening for an empty window', () => {
    const at = new Date('2026-10-13T02:00:00Z');
    expect(nextOpen(at, { start: '09:00', end: '18:00', days: [] }, 'UTC')).toBeUndefined();
    expect(nextOpen(at, { start: '18:00', end: '09:00', days: [1] }, 'UTC')).toBeUndefined();
    expect(nextOpen(at, { start: '01:00', end: '03:00', days: [2] }, 'UTC')).toBe(at);
  });
});

describe('reports', () => {
  const base = {
    contact: { email: 'ana@acme.example', timezone: 'Asia/Singapore', status: 'new' as const },
    company: { country: 'SG', domain: 'acme.example' },
    at: new Date('2026-10-13T02:00:00Z'),
    workspace: {
      senderName: 'Mei',
      physicalAddress: '1 Demo Street',
      timezone: 'Asia/Singapore',
      dailySendCap: 150,
      warmup: { enabled: false, startPerDay: 20, increasePerDay: 5, max: 150 },
      complianceOverrides: {},
    },
    consents: [{ basis: 'legitimate_interest' as const, evidence: 'https://acme.example' }],
    suppressions: [],
    recentSends: [],
    domainSends: [],
    mailboxSentToday: 0,
    mailboxDay: 0,
  };
  const ok = check(base);
  const personal = check({ ...base, contact: { ...base.contact, email: 'ana@gmail.com' } });
  const suppressed = check({ ...base, contact: { ...base.contact, status: 'suppressed' } });
  const capped = check({
    ...base,
    domainSends: [{ at: base.at }, { at: base.at }, { at: base.at }],
  });
  const missing = check({ ...base, workspace: { ...base.workspace, physicalAddress: undefined } });

  it.each([
    [ok, 'ok'],
    [personal, 'needs_consent'],
    [suppressed, 'suppressed'],
    [capped, 'ok'],
    [missing, 'blocked'],
  ] as [Decision, string][])('status %#: %s', (d, status) => {
    expect(statusOf(d)).toBe(status);
  });

  it('summarises a batch by first reason', () => {
    const s = summarize([ok, ok, ok, personal, personal, suppressed, capped]);
    expect(s).toMatchObject({ ready: 3, blocked: 4 });
    expect(s.text).toBe(
      '3 ready · 4 blocked: 2 personal emails without consent, 1 suppressed, 1 duplicate domain cap',
    );
    expect(summarize([ok]).text).toBe('1 ready · 0 blocked');
  });

  it('finds stale prospects by pack retention', () => {
    const now = new Date('2026-10-13T00:00:00Z');
    const old = new Date(now.getTime() - 200 * DAY);
    expect(isStale({ status: 'contacted', updatedAt: old }, VN, now)).toBe(true);
    expect(isStale({ status: 'contacted', updatedAt: old }, SG, now)).toBe(false);
    expect(isStale({ status: 'interested', updatedAt: old }, VN, now)).toBe(false);
  });
});
