import { z } from 'zod';
import type { Country } from './common.ts';

/** Workspace roles, lowest to highest. A workspace is a Better Auth organization. */
export const ROLES = ['member', 'admin', 'owner'] as const;
export const role = z.enum(ROLES);
export type Role = z.infer<typeof role>;

/** The highest known role in a Better Auth role string such as `"admin,member"`. */
export function topRole(roles: string): Role | undefined {
  const held = roles.split(',').map((r) => r.trim());
  return ROLES.findLast((r) => held.includes(r));
}

export const hasRole = (held: Role, required: Role) =>
  ROLES.indexOf(held) >= ROLES.indexOf(required);

/** Scopes requested at "Connect mailbox" (incremental auth), not at first sign-in. */
export const GOOGLE_MAILBOX_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

/** A company website as typed ("acme.com", "https://www.acme.com/about") → its origin. */
export const website = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname)) return url.origin.toLowerCase();
    } catch {}
    ctx.addIssue({ code: 'custom', message: 'Enter your company website, e.g. acme.com' });
    return z.NEVER;
  });

const hostOf = (site: string) => new URL(site).hostname.replace(/^www\./, '');

/** "https://acme-labs.co.uk" → "Acme Labs". */
export function workspaceName(site: string) {
  const [label = site] = hostOf(site).split('.');
  return label
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** A best guess from the country-code TLD ("acme.co.id" → "ID"); the profiler refines it. */
export function countryFromSite(site: string, fallback: Country = 'US'): Country {
  const tld = hostOf(site).split('.').pop() ?? '';
  if (tld === 'uk') return 'GB';
  return tld.length === 2 ? tld.toUpperCase() : fallback;
}
