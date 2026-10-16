import { country, lawfulBasis, timeOfDay, weekday } from '@sutra/domain';
import { z } from 'zod';

/** `required`: the send is blocked if it can't be met. `recommended`: applied when possible. */
export const need = z.enum(['required', 'recommended']);
export type Need = z.infer<typeof need>;

/** Local time of day and weekdays (0 = Sunday) in the contact's time zone. */
export const sendWindow = z.object({
  start: timeOfDay,
  end: timeOfDay,
  days: z.array(weekday),
});
export type SendWindow = z.infer<typeof sendWindow>;

export const emailRules = z.object({
  /** Lawful bases accepted for cold B2B email. */
  basis: z.array(lawfulBasis).min(1),
  /** Personal-looking (free-mail) addresses need explicit consent. */
  b2bOnly: z.boolean(),
  unsubscribe: need,
  listUnsubscribeHeader: need,
  senderIdentity: need,
  physicalAddress: need,
});

export const frequency = z.object({
  /** Rolling 7 days, per contact. */
  perContactPerWeek: z.int().min(1),
  /** Rolling 24 hours, per recipient domain, so one company is never flooded. */
  perDomainPerDay: z.int().min(1),
});

/**
 * A country compliance pack: product rules as data. Adding a country means adding one file in
 * `packs/`. Values are starting defaults, not legal advice.
 */
export const pack = z.object({
  country: z.union([country, z.literal('DEFAULT')]),
  name: z.string(),
  /** Bumped whenever a value changes; recorded on every decision. */
  version: z.string().regex(/^\d{4}\.\d{2}$/),
  sendWindow,
  email: emailRules,
  frequency,
  /** Stale prospects are anonymised after this many days without activity. */
  retentionDays: z.int().min(1),
  /** The rules each value reflects, shown in Settings. */
  references: z.array(z.string()),
});
export type Pack = z.infer<typeof pack>;

/** A workspace's per-country override. Applied stricter-only: it can never loosen a pack. */
export const packOverride = z
  .object({
    sendWindow: sendWindow.partial(),
    email: emailRules.partial(),
    frequency: frequency.partial(),
    retentionDays: pack.shape.retentionDays,
  })
  .partial();
export type PackOverride = z.infer<typeof packOverride>;

const NEEDS = [
  'unsubscribe',
  'listUnsubscribeHeader',
  'senderIdentity',
  'physicalAddress',
] as const;
const later = (a: string, b = a) => (a > b ? a : b);
const earlier = (a: string, b = a) => (a < b ? a : b);
const stricterNeed = (a: Need, b: Need = a): Need => (a === 'required' ? a : b);
const smaller = (a: number, b = a) => Math.min(a, b);

/** Merges `o` into `p`, keeping whichever value is stricter for every field. */
export function tighten(p: Pack, o: PackOverride): Pack {
  const w = o.sendWindow ?? {};
  const e = o.email ?? {};
  const f = o.frequency ?? {};
  return {
    ...p,
    sendWindow: {
      start: later(p.sendWindow.start, w.start),
      end: earlier(p.sendWindow.end, w.end),
      days: p.sendWindow.days.filter((d) => w.days?.includes(d) ?? true),
    },
    email: {
      basis: p.email.basis.filter((b) => e.basis?.includes(b) ?? true),
      b2bOnly: p.email.b2bOnly || e.b2bOnly === true,
      ...(Object.fromEntries(NEEDS.map((k) => [k, stricterNeed(p.email[k], e[k])])) as Pick<
        Pack['email'],
        (typeof NEEDS)[number]
      >),
    },
    frequency: {
      perContactPerWeek: smaller(p.frequency.perContactPerWeek, f.perContactPerWeek),
      perDomainPerDay: smaller(p.frequency.perDomainPerDay, f.perDomainPerDay),
    },
    retentionDays: smaller(p.retentionDays, o.retentionDays),
  };
}
