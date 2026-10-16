import { createHash } from 'node:crypto';

/** Consumer mailbox providers: an address here is personal, not a business address. */
const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'ymail.com',
  'rocketmail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'tutanota.com',
  'fastmail.com',
  'qq.com',
  '163.com',
  '126.com',
  'naver.com',
  'rediffmail.com',
  'docomo.ne.jp',
  'ezweb.ne.jp',
  'softbank.ne.jp',
  'i.softbank.jp',
  'bigpond.com',
  'optusnet.com.au',
  'singnet.com.sg',
]);
/** Providers with a domain per country, e.g. `yahoo.co.id`, `hotmail.co.th`, `outlook.jp`. */
const FREE_MAIL_BRANDS = /^(yahoo|hotmail|outlook|live|msn|aol)\.[a-z]{2,3}(\.[a-z]{2})?$/;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The part after `@`, lower-cased. */
export function domainOf(email: string) {
  const e = normalizeEmail(email);
  return e.slice(e.lastIndexOf('@') + 1);
}

/** Free-mail and other personal-looking addresses need explicit consent. */
export function isPersonalEmail(email: string) {
  const domain = domainOf(email);
  return FREE_MAIL.has(domain) || FREE_MAIL_BRANDS.test(domain);
}

/** The `email_hash` suppression value: keeps an erased person suppressed without their address. */
export const emailHash = (email: string) =>
  createHash('sha256').update(normalizeEmail(email)).digest('hex');

/** `a.b.acme.com` → `['a.b.acme.com', 'b.acme.com', 'acme.com']`: a domain suppression covers subdomains. */
export function domainsOf(domain: string) {
  const labels = domain.toLowerCase().split('.');
  return labels.slice(0, -1).map((_, i) => labels.slice(i).join('.'));
}
