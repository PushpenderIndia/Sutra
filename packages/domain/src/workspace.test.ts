import { describe, expect, it } from 'vitest';
import { countryFromSite, hasRole, topRole, website, workspaceName } from './workspace.ts';

describe('workspace helpers', () => {
  it('ranks roles', () => {
    expect(topRole('admin,member')).toBe('admin');
    expect(topRole('owner')).toBe('owner');
    expect(topRole('guest')).toBeUndefined();
    expect(hasRole('owner', 'admin')).toBe(true);
    expect(hasRole('member', 'admin')).toBe(false);
  });

  it('normalises a typed website to its origin', () => {
    expect(website.parse(' Acme.com ')).toBe('https://acme.com');
    expect(website.parse('http://www.acme.co.id/about?x=1')).toBe('http://www.acme.co.id');
    expect(website.safeParse('not a site').success).toBe(false);
    expect(website.safeParse('localhost').success).toBe(false);
  });

  it('names the workspace and guesses the country from the domain', () => {
    expect(workspaceName('https://www.acme-labs.co.uk')).toBe('Acme Labs');
    expect(countryFromSite('https://acme-labs.co.uk')).toBe('GB');
    expect(countryFromSite('https://kopi.co.id')).toBe('ID');
    expect(countryFromSite('https://acme.com')).toBe('US');
  });
});
