import type { EmailConfidence } from '@sutra/domain';

/** Generic inbox prefixes: allowed, but only ever `role` confidence (never guessed as a person). */
const ROLE_PREFIXES = [
  'info',
  'hello',
  'hi',
  'contact',
  'sales',
  'admin',
  'team',
  'support',
  'enquiries',
  'enquiry',
  'office',
  'marketing',
];

const ROLE_RE = new RegExp(`^(${ROLE_PREFIXES.join('|')})@`, 'i');

/** True for a generic inbox such as `info@` or `hello@`. */
export const isRoleEmail = (email: string): boolean => ROLE_RE.test(email.trim());

const sanitise = (part: string): string =>
  part
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Splits a full name into first and (optional) last parts, dropping salutations. */
export function nameParts(name: string): { first?: string; last?: string } {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(mr|mrs|ms|dr|prof)\.?$/i.test(w));
  const lastWord = words.length > 1 ? words[words.length - 1] : undefined;
  const first = words[0] ? sanitise(words[0]) : undefined;
  const last = lastWord ? sanitise(lastWord) : undefined;
  return { first: first || undefined, last: last || undefined };
}

/**
 * Common corporate address patterns for a person at a domain, best-known first: `first@`,
 * `first.last@`, `flast@`. Deterministic, so the same person always yields the same guess.
 */
export function emailPatterns(name: string, domain: string): string[] {
  const { first, last } = nameParts(name);
  if (!first) return [];
  const locals = last ? [`${first}.${last}`, `${first[0]}${last}`, first] : [first];
  return [...new Set(locals)].map((local) => `${local}@${domain}`);
}

/** A workspace's role inbox for a domain, used when no person can be found. */
export const roleEmail = (domain: string): string => `info@${domain}`;

export interface GuessedEmail {
  email: string;
  confidence: EmailConfidence;
}

/**
 * Decides a contact's email and its confidence:
 * - a published address → `verified`
 * - else the best pattern guess, when the domain accepts mail (MX) → `pattern`
 * - else, as a last resort, the role inbox → `role`
 */
export async function resolveEmail(
  opts: { name?: string; publishedEmail?: string; domain: string },
  hasMx: (domain: string) => Promise<boolean>,
): Promise<GuessedEmail | undefined> {
  const { name, publishedEmail, domain } = opts;
  if (publishedEmail) {
    const email = publishedEmail.trim().toLowerCase();
    return { email, confidence: isRoleEmail(email) ? 'role' : 'verified' };
  }
  const [guess] = name ? emailPatterns(name, domain) : [];
  if (guess && (await hasMx(domain))) return { email: guess, confidence: 'pattern' };
  return undefined;
}
