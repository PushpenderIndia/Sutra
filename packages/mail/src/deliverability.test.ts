import { describe, expect, it } from 'vitest';
import { deliverability } from './deliverability.ts';

const dns = (records: Record<string, string[]>) => async (name: string) => {
  if (!records[name]) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return records[name].map((r) => [r]);
};

describe('deliverability', () => {
  it('passes a domain with Google SPF, DKIM and an enforced DMARC policy', async () => {
    const r = await deliverability(
      'mei@pixelpress.example',
      dns({
        'pixelpress.example': ['google-site-verification=x', 'v=spf1 include:_spf.google.com ~all'],
        'google._domainkey.pixelpress.example': ['v=DKIM1; k=rsa; p=MIIB'],
        '_dmarc.pixelpress.example': ['v=DMARC1; p=quarantine'],
      }),
    );
    expect([r.spf.status, r.dkim.status, r.dmarc.status]).toEqual(['pass', 'pass', 'pass']);
  });

  it('warns and explains what is missing', async () => {
    const r = await deliverability(
      'mei@acme.example',
      dns({
        'acme.example': ['v=spf1 include:mailgun.org ~all'],
        '_dmarc.acme.example': ['v=DMARC1; p=none'],
      }),
    );
    expect(r.spf).toMatchObject({ status: 'warn' });
    expect(r.dkim).toMatchObject({ status: 'missing' });
    expect(r.dmarc).toMatchObject({ status: 'warn' });
  });

  it('treats gmail.com as managed by Google', async () => {
    expect(await deliverability('someone@gmail.com', dns({}))).toMatchObject({ managed: true });
  });
});
