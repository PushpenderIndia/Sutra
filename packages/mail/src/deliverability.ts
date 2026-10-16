import { resolveTxt } from 'node:dns/promises';
import { domainOf } from '@sutra/compliance';

export type CheckStatus = 'pass' | 'warn' | 'missing';
export interface DnsCheck {
  status: CheckStatus;
  record?: string;
  hint: string;
}
export interface Deliverability {
  domain: string;
  /** Gmail-hosted addresses (`gmail.com`): Google manages SPF, DKIM and DMARC. */
  managed: boolean;
  spf: DnsCheck;
  dkim: DnsCheck;
  dmarc: DnsCheck;
}

type Resolve = (name: string) => Promise<string[][]>;
const MANAGED = new Set(['gmail.com', 'googlemail.com']);

/** TXT records at `name` starting with `prefix` (none on NXDOMAIN or timeout). */
async function txt(resolve: Resolve, name: string, prefix: string) {
  const records = await resolve(name).catch(() => []);
  return records.map((r) => r.join('')).find((r) => r.toLowerCase().startsWith(prefix));
}

/**
 * The setup checklist for a sender: SPF (authorising Google), DKIM (Google Workspace's default
 * `google` selector) and DMARC for the sender's domain, from DNS.
 */
export async function deliverability(
  email: string,
  resolve: Resolve = resolveTxt,
): Promise<Deliverability> {
  const domain = domainOf(email);
  if (MANAGED.has(domain)) {
    const ok = { status: 'pass', hint: 'Managed by Google' } as const;
    return { domain, managed: true, spf: ok, dkim: ok, dmarc: ok };
  }
  const [spf, dkim, dmarc] = await Promise.all([
    txt(resolve, domain, 'v=spf1'),
    txt(resolve, `google._domainkey.${domain}`, 'v=dkim1'),
    txt(resolve, `_dmarc.${domain}`, 'v=dmarc1'),
  ]);
  return {
    domain,
    managed: false,
    spf: !spf
      ? { status: 'missing', hint: `Add TXT "v=spf1 include:_spf.google.com ~all" at ${domain}` }
      : spf.includes('_spf.google.com')
        ? { status: 'pass', record: spf, hint: 'Google is authorised to send' }
        : { status: 'warn', record: spf, hint: 'Add include:_spf.google.com to your SPF record' },
    dkim: dkim
      ? { status: 'pass', record: dkim, hint: 'Signed by Google Workspace' }
      : { status: 'missing', hint: 'Turn on DKIM in the Google Workspace admin console' },
    dmarc: !dmarc
      ? { status: 'missing', hint: `Add TXT "v=DMARC1; p=none" at _dmarc.${domain}` }
      : /p=(quarantine|reject)/i.test(dmarc)
        ? { status: 'pass', record: dmarc, hint: 'DMARC policy enforced' }
        : { status: 'warn', record: dmarc, hint: 'Policy is p=none: monitoring only' },
  };
}
