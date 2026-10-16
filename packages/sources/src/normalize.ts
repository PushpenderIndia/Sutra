import type { Country } from '@sutra/domain';

/** Company name suffixes dropped before comparing names (so "Acme Pte Ltd" ≈ "Acme"). */
const SUFFIXES =
  /\b(inc|incorporated|llc|ltd|limited|pte|plc|gmbh|co|corp|corporation|company|group|holdings|pvt|private|sdn|bhd|tbk|pt)\b/g;

/** Lower-cased, punctuation- and suffix-free name; with `country` it is the fallback dedupe key. */
export function normalizeName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(SUFFIXES, ' ')
      .replace(/\s+/g, ' ')
      .trim() || name.toLowerCase().trim()
  );
}

/** Hostname without a leading `www.`, lower-cased; `undefined` when the website can't be parsed. */
export function domainFromWebsite(website: string | undefined): string | undefined {
  if (!website) return undefined;
  const value = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  try {
    const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : undefined;
  } catch {
    return undefined;
  }
}

/** An `https://` website for a bare domain, so companies found by domain still link out. */
export const websiteFromDomain = (domain: string): string => `https://${domain}`;

/** A best guess at the country from a domain's ccTLD ("acme.co.id" → "ID"), else the fallback. */
export function countryFromDomain(domain: string | undefined, fallback: Country): Country {
  const tld = domain?.split('.').pop() ?? '';
  if (tld === 'uk') return 'GB';
  return /^[a-z]{2}$/.test(tld) ? (tld.toUpperCase() as Country) : fallback;
}

/** The dedupe key for a company: its `domain`, else `normalizedName|country`. */
export const companyKey = (opts: {
  domain?: string;
  normalizedName: string;
  country: Country;
}): string => opts.domain ?? `${opts.normalizedName}|${opts.country}`;
