import { describe, expect, it } from 'vitest';
import { PACKS, SG } from '../packs/index.ts';
import { emailHash } from './address.ts';
import {
  type AllowDecision,
  type CheckInput,
  check,
  type Decision,
  mailboxCap,
  packFor,
} from './check.ts';
import { tighten } from './pack.ts';
import { DAY } from './time.ts';

const HOUR = DAY / 24;
/** Tuesday 13 Oct 2026, 10:00 in Singapore. */
const TUE_10_SGT = new Date('2026-10-13T02:00:00Z');

type Overrides = Partial<Omit<CheckInput, 'contact' | 'company' | 'workspace'>> & {
  contact?: Partial<CheckInput['contact']>;
  company?: Partial<CheckInput['company']>;
  workspace?: Partial<CheckInput['workspace']>;
};

function input(o: Overrides = {}): CheckInput {
  return {
    at: TUE_10_SGT,
    consents: [{ basis: 'legitimate_interest', evidence: 'https://acme.example/team' }],
    suppressions: [],
    recentSends: [],
    domainSends: [],
    mailboxSentToday: 0,
    mailboxDay: 30,
    ...o,
    contact: { email: 'ana@acme.example', timezone: 'Asia/Singapore', status: 'new', ...o.contact },
    company: { country: 'SG', domain: 'acme.example', ...o.company },
    workspace: {
      senderName: 'Mei Tan',
      physicalAddress: '1 Demo Street, Singapore',
      timezone: 'Asia/Singapore',
      dailySendCap: 150,
      warmup: { enabled: true, startPerDay: 20, increasePerDay: 5, max: 150 },
      complianceOverrides: {},
      ...o.workspace,
    },
  };
}

const codes = (d: Decision) => (d.allow ? [] : d.reasons.map((r) => r.code));
const retryAt = (d: Decision) => (d.allow ? undefined : d.retryAt?.toISOString());
const consent = [{ basis: 'consent' as const, evidence: 'signup form' }];
const ago = (ms: number, from = TUE_10_SGT) => ({ at: new Date(from.getTime() - ms) });

describe('check: send window in the contact time zone', () => {
  // [case, country, contact time zone, now, retryAt (undefined = allowed)]
  const cases: [string, string, string, string, string | undefined][] = [
    ['SG inside hours', 'SG', 'Asia/Singapore', '2026-10-13T02:00:00Z', undefined],
    ['SG before 09:00', 'SG', 'Asia/Singapore', '2026-10-13T00:59:00Z', '2026-10-13T01:00:00.000Z'],
    [
      'SG at 18:00 (end exclusive)',
      'SG',
      'Asia/Singapore',
      '2026-10-13T10:00:00Z',
      '2026-10-14T01:00:00.000Z',
    ],
    [
      'SG Friday evening → Monday',
      'SG',
      'Asia/Singapore',
      '2026-10-16T10:30:00Z',
      '2026-10-19T01:00:00.000Z',
    ],
    [
      'SG Saturday → Monday',
      'SG',
      'Asia/Singapore',
      '2026-10-17T04:00:00Z',
      '2026-10-19T01:00:00.000Z',
    ],
    [
      'IN 09:45 IST (UTC+5:30)',
      'IN',
      'Asia/Kolkata',
      '2026-10-13T04:15:00Z',
      '2026-10-13T04:30:00.000Z',
    ],
    ['IN 17:59 IST', 'IN', 'Asia/Kolkata', '2026-10-13T12:29:00Z', undefined],
    [
      'ID 17:00 WIB → next day',
      'ID',
      'Asia/Jakarta',
      '2026-10-13T10:00:00Z',
      '2026-10-14T02:00:00.000Z',
    ],
    ['PH 12:00 PHT', 'PH', 'Asia/Manila', '2026-10-13T04:00:00Z', undefined],
    [
      'TH Sunday → Monday',
      'TH',
      'Asia/Bangkok',
      '2026-10-18T05:00:00Z',
      '2026-10-19T02:00:00.000Z',
    ],
    [
      'VN 08:15 → 08:30',
      'VN',
      'Asia/Ho_Chi_Minh',
      '2026-10-13T01:15:00Z',
      '2026-10-13T01:30:00.000Z',
    ],
    ['JP Monday 09:00 (start inclusive)', 'JP', 'Asia/Tokyo', '2026-10-19T00:00:00Z', undefined],
    [
      'JP Sunday night → Monday',
      'JP',
      'Asia/Tokyo',
      '2026-10-18T14:00:00Z',
      '2026-10-19T00:00:00.000Z',
    ],
    ['MY Thursday', 'MY', 'Asia/Kuala_Lumpur', '2026-10-15T02:00:00Z', undefined],
    [
      'MY Friday → Monday',
      'MY',
      'Asia/Kuala_Lumpur',
      '2026-10-16T02:00:00Z',
      '2026-10-19T01:00:00.000Z',
    ],
    ['AU before DST, 09:00 AEST', 'AU', 'Australia/Sydney', '2026-09-27T23:00:00Z', undefined],
    [
      'AU before DST, 08:30 AEST',
      'AU',
      'Australia/Sydney',
      '2026-09-27T22:30:00Z',
      '2026-09-27T23:00:00.000Z',
    ],
    [
      'AU across DST start → 09:00 AEDT',
      'AU',
      'Australia/Sydney',
      '2026-10-02T08:00:00Z',
      '2026-10-04T22:00:00.000Z',
    ],
    [
      'AU after DST, 08:30 AEDT',
      'AU',
      'Australia/Sydney',
      '2026-10-04T21:30:00Z',
      '2026-10-04T22:00:00.000Z',
    ],
    [
      'AU across DST end → 09:00 AEST',
      'AU',
      'Australia/Sydney',
      '2026-04-03T06:30:00Z',
      '2026-04-05T23:00:00.000Z',
    ],
    ['AU Perth (no DST)', 'AU', 'Australia/Perth', '2026-10-13T02:00:00Z', undefined],
    [
      'DEFAULT for unknown country, Friday → Monday',
      'US',
      'America/New_York',
      '2026-10-16T15:00:00Z',
      '2026-10-19T14:00:00.000Z',
    ],
    [
      'DEFAULT across US DST end',
      'US',
      'America/New_York',
      '2026-10-29T20:30:00Z',
      '2026-11-02T15:00:00.000Z',
    ],
  ];
  it.each(cases)('%s', (_, country, timezone, at, expected) => {
    const d = check(
      input({ at: new Date(at), consents: consent, contact: { timezone }, company: { country } }),
    );
    expect(retryAt(d)).toBe(expected);
    expect(codes(d)).toEqual(expected ? ['outside_send_window'] : []);
  });
});

describe('check: suppression', () => {
  const s = (scope: 'email' | 'domain' | 'email_hash', value: string) => ({
    kind: 'opt_out' as const,
    scope,
    value,
  });
  // [case, contact email, company domain, suppressions, suppressed?]
  const cases: [string, string, string | undefined, ReturnType<typeof s>[], boolean][] = [
    ['email opt-out', 'ana@acme.example', 'acme.example', [s('email', 'ana@acme.example')], true],
    [
      'email match ignores case',
      'Ana@ACME.example',
      'acme.example',
      [s('email', 'ana@acme.example')],
      true,
    ],
    ['domain opt-out', 'ana@acme.example', 'acme.example', [s('domain', 'acme.example')], true],
    [
      'parent domain covers subdomains',
      'ana@mail.acme.example',
      undefined,
      [s('domain', 'acme.example')],
      true,
    ],
    [
      "company's domain",
      'ana@acme-group.example',
      'acme.example',
      [s('domain', 'acme.example')],
      true,
    ],
    [
      'erased person (hash)',
      'ana@acme.example',
      'acme.example',
      [s('email_hash', emailHash('ana@acme.example'))],
      true,
    ],
    [
      'unrelated entries',
      'ana@acme.example',
      'acme.example',
      [
        s('email', 'bo@acme.example'),
        s('domain', 'example'),
        s('domain', 'other.example'),
        s('email_hash', emailHash('bo@acme.example')),
      ],
      false,
    ],
  ];
  it.each(cases)('%s', (_, email, domain, suppressions, suppressed) => {
    const d = check(input({ contact: { email }, company: { domain }, suppressions }));
    expect(codes(d)).toEqual(suppressed ? ['suppressed'] : []);
    expect(retryAt(d)).toBeUndefined();
  });

  it('blocks a contact whose status is suppressed', () => {
    expect(codes(check(input({ contact: { status: 'suppressed' } })))).toEqual(['suppressed']);
  });

  it('is permanent: no retryAt even alongside temporary reasons', () => {
    const d = check(
      input({ at: new Date('2026-10-13T12:00:00Z'), suppressions: [s('domain', 'acme.example')] }),
    );
    expect(codes(d)).toEqual(['suppressed', 'outside_send_window']);
    expect(retryAt(d)).toBeUndefined();
  });
});

describe('check: lawful basis and free-mail detection', () => {
  const li = (evidence = 'https://acme.example/team') => [
    { basis: 'legitimate_interest' as const, evidence },
  ];
  // [case, country, email, consents, reason (undefined = allowed)]
  const cases: [string, string, string, CheckInput['consents'], string | undefined][] = [
    ['SG business address, public page evidence', 'SG', 'ana@acme.example', li(), undefined],
    [
      'SG legitimate interest without an evidence URL',
      'SG',
      'ana@acme.example',
      li('found it'),
      'no_lawful_basis',
    ],
    ['SG no record at all', 'SG', 'ana@acme.example', [], 'no_lawful_basis'],
    [
      'SG gmail with legitimate interest only',
      'SG',
      'ana@gmail.com',
      li(),
      'personal_email_without_consent',
    ],
    ['SG gmail with consent', 'SG', 'ana@gmail.com', consent, undefined],
    [
      'ID yahoo.co.id existing customer',
      'ID',
      'budi@yahoo.co.id',
      [{ basis: 'existing_customer', evidence: 'invoice 42' }],
      undefined,
    ],
    [
      'JP hotmail.co.jp legitimate interest',
      'JP',
      'ken@hotmail.co.jp',
      li(),
      'personal_email_without_consent',
    ],
    ['TH outlook.co.th no record', 'TH', 'som@outlook.co.th', [], 'personal_email_without_consent'],
    [
      'VN business legitimate interest (consent required)',
      'VN',
      'linh@pho.example',
      li(),
      'no_lawful_basis',
    ],
    ['VN business consent', 'VN', 'linh@pho.example', consent, undefined],
    ['DEFAULT business legitimate interest', 'US', 'jo@acme.example', li(), 'no_lawful_basis'],
    [
      'brand-like company domain is still business',
      'SG',
      'ana@outlook.acme.example',
      li(),
      undefined,
    ],
  ];
  it.each(cases)('%s', (_, country, email, consents, reason) => {
    // A time inside every pack's window: Tuesday 13:00 in each contact's zone (all UTC+7..+9 here).
    const d = check(
      input({
        consents,
        contact: { email, timezone: 'Asia/Singapore' },
        company: { country },
        at: new Date('2026-10-13T05:00:00Z'),
      }),
    );
    expect(codes(d)).toEqual(reason ? [reason] : []);
  });

  it('lets a pack without b2bOnly treat free-mail like business mail', () => {
    const packs = { SG: { ...SG, email: { ...SG.email, b2bOnly: false } } };
    expect(check(input({ contact: { email: 'ana@gmail.com' } }), packs).allow).toBe(true);
  });
});

describe('check: frequency and mailbox caps', () => {
  // [case, input overrides, reason (undefined = allowed), retryAt]
  const cases: [string, Overrides, string | undefined, string | undefined][] = [
    ['one send this week', { recentSends: [ago(2 * DAY)] }, undefined, undefined],
    [
      'two sends this week (SG cap 2)',
      { recentSends: [ago(6 * DAY), ago(DAY)] },
      'contact_frequency_cap',
      '2026-10-14T02:00:00.000Z',
    ],
    ['older sends roll off', { recentSends: [ago(8 * DAY), ago(DAY)] }, undefined, undefined],
    [
      'three sends to the domain today (SG cap 3)',
      { domainSends: [ago(20 * HOUR), ago(2 * HOUR), ago(HOUR)] },
      'domain_frequency_cap',
      '2026-10-13T06:00:00.000Z',
    ],
    [
      'domain send 25h ago rolls off',
      { domainSends: [ago(25 * HOUR), ago(2 * HOUR), ago(HOUR)] },
      undefined,
      undefined,
    ],
    ['warm-up day 1: 19 sent', { mailboxDay: 0, mailboxSentToday: 19 }, undefined, undefined],
    [
      'warm-up day 1: 20 sent → tomorrow 09:00',
      { mailboxDay: 0, mailboxSentToday: 20 },
      'mailbox_daily_cap',
      '2026-10-14T01:00:00.000Z',
    ],
    ['warm-up day 3: 29 sent', { mailboxDay: 2, mailboxSentToday: 29 }, undefined, undefined],
    [
      'warm-up day 3: 30 sent',
      { mailboxDay: 2, mailboxSentToday: 30 },
      'mailbox_daily_cap',
      '2026-10-14T01:00:00.000Z',
    ],
    [
      'warm-up off, daily cap 150',
      {
        mailboxSentToday: 150,
        workspace: { warmup: { enabled: false, startPerDay: 20, increasePerDay: 5, max: 150 } },
      },
      'mailbox_daily_cap',
      '2026-10-14T01:00:00.000Z',
    ],
  ];
  it.each(cases)('%s', (_, o, reason, expected) => {
    const d = check(input(o));
    expect(codes(d)).toEqual(reason ? [reason] : []);
    expect(retryAt(d)).toBe(expected);
  });

  it('retries when the last temporary block lifts, inside the send window', () => {
    // Tuesday 20:00 SGT: outside hours, and the weekly cap lifts Wednesday 10:00.
    const at = new Date('2026-10-13T12:00:00Z');
    const d = check(input({ at, recentSends: [ago(6 * DAY + 10 * HOUR, at), ago(HOUR, at)] }));
    expect(codes(d)).toEqual(['outside_send_window', 'contact_frequency_cap']);
    expect(retryAt(d)).toBe('2026-10-14T02:00:00.000Z');
  });

  it('caps the warm-up ramp at max and the daily cap', () => {
    const ws = input().workspace;
    expect(mailboxCap(ws, 0)).toBe(20);
    expect(mailboxCap(ws, 10)).toBe(70);
    expect(mailboxCap(ws, 100)).toBe(150);
    expect(mailboxCap({ ...ws, dailySendCap: 60 }, 100)).toBe(60);
  });
});

describe('check: requirements', () => {
  it('lists every requirement when the workspace can meet them', () => {
    const d = check(input());
    expect(d).toMatchObject({ allow: true, pack: 'SG', packVersion: '2026.10' });
    expect(d.allow && d.requirements).toEqual([
      'unsubscribe_link',
      'list_unsubscribe_header',
      'sender_identity',
      'physical_address',
    ]);
  });
  // [case, country, workspace, blocked?]
  const cases: [string, string, Partial<CheckInput['workspace']>, boolean][] = [
    ['SG requires a physical address', 'SG', { physicalAddress: undefined }, true],
    ['blank address counts as missing', 'SG', { physicalAddress: '   ' }, true],
    ['blank sender name', 'SG', { senderName: ' ' }, true],
    ['IN only recommends an address', 'IN', { physicalAddress: undefined }, false],
  ];
  it.each(cases)('%s', (_, country, workspace, blocked) => {
    const d = check(
      input({
        company: { country },
        contact: { timezone: 'Asia/Kolkata' },
        at: new Date('2026-10-13T06:00:00Z'),
        workspace,
      }),
    );
    expect(codes(d)).toEqual(blocked ? ['missing_requirement'] : []);
    if (d.allow) expect(d.requirements).not.toContain('physical_address');
  });
});

describe('check: workspace overrides are stricter-only', () => {
  const at = (iso: string) => ({ at: new Date(iso) });
  // [case, overrides, input, reasons, retryAt]
  const cases: [
    string,
    Record<string, Record<string, unknown>>,
    Overrides,
    string[],
    string | undefined,
  ][] = [
    [
      'later start',
      { SG: { sendWindow: { start: '11:00' } } },
      {},
      ['outside_send_window'],
      '2026-10-13T03:00:00.000Z',
    ],
    [
      'looser values are ignored',
      { SG: { sendWindow: { start: '07:00', end: '20:00' }, frequency: { perContactPerWeek: 9 } } },
      { ...at('2026-10-13T00:00:00Z'), recentSends: [ago(DAY), ago(2 * DAY)] },
      ['outside_send_window', 'contact_frequency_cap'],
      '2026-10-19T01:00:00.000Z',
    ],
    [
      'invalid override is ignored',
      { SG: { frequency: { perContactPerWeek: 'x' } } },
      {},
      [],
      undefined,
    ],
    [
      'narrower basis',
      { SG: { email: { basis: ['consent'] } } },
      {},
      ['no_lawful_basis'],
      undefined,
    ],
    [
      'stricter requirement',
      { IN: { email: { physicalAddress: 'required' } } },
      { company: { country: 'IN' }, workspace: { physicalAddress: undefined } },
      ['missing_requirement'],
      undefined,
    ],
    ['no days left', { SG: { sendWindow: { days: [0] } } }, {}, ['no_send_window'], undefined],
    ['empty window', { SG: { sendWindow: { end: '08:00' } } }, {}, ['no_send_window'], undefined],
    [
      'overrides of other countries do not apply',
      { JP: { sendWindow: { start: '17:00' } } },
      {},
      [],
      undefined,
    ],
    [
      'DEFAULT key overrides unknown countries',
      { DEFAULT: { sendWindow: { start: '11:00' } } },
      {
        company: { country: 'US' },
        contact: { timezone: 'America/New_York' },
        consents: consent,
        ...at('2026-10-13T14:30:00Z'),
      },
      ['outside_send_window'],
      '2026-10-13T15:00:00.000Z',
    ],
  ];
  it.each(cases)('%s', (_, complianceOverrides, o, reasons, expected) => {
    const d = check(input({ ...o, workspace: { ...o.workspace, complianceOverrides } }));
    expect(codes(d)).toEqual(reasons);
    expect(retryAt(d)).toBe(expected);
  });
});

describe('packs', () => {
  const all = [...Object.values(PACKS), packFor('ZZ')];

  it('ships the launch countries plus DEFAULT', () => {
    expect(all.map((p) => p.country).sort()).toEqual(
      ['AU', 'DEFAULT', 'ID', 'IN', 'JP', 'MY', 'PH', 'SG', 'TH', 'VN'].sort(),
    );
  });

  it.each(all)('$country: DEFAULT is at least as strict', (p) => {
    const merged = tighten(p, packFor('ZZ'));
    const { country, name, version, references, ...rules } = packFor('ZZ');
    expect(merged).toMatchObject(rules);
  });

  it('tightens every field with a full override', () => {
    const t = tighten(SG, {
      sendWindow: { start: '10:00', end: '17:00', days: [2, 3] },
      email: {
        basis: ['consent'],
        b2bOnly: true,
        physicalAddress: 'required',
        unsubscribe: 'required',
      },
      frequency: { perContactPerWeek: 1, perDomainPerDay: 1 },
      retentionDays: 30,
    });
    expect(t).toMatchObject({
      sendWindow: { start: '10:00', end: '17:00', days: [2, 3] },
      email: { basis: ['consent'], b2bOnly: true },
      frequency: { perContactPerWeek: 1, perDomainPerDay: 1 },
      retentionDays: 30,
    });
    expect(
      tighten({ ...SG, email: { ...SG.email, b2bOnly: false } }, { email: { b2bOnly: true } }).email
        .b2bOnly,
    ).toBe(true);
  });
});

describe('AllowDecision', () => {
  it('can only come from check()', () => {
    const send = (d: AllowDecision) => d.requirements;
    const d = check(input());
    if (d.allow) expect(send(d)).toHaveLength(4);
    // @ts-expect-error a hand-built permit doesn't type-check
    send({ allow: true, requirements: [], pack: 'SG', packVersion: '2026.10' });
    // @ts-expect-error neither does an unchecked decision
    send(check(input()));
  });
});
