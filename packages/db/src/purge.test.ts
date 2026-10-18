import { beforeEach, describe, expect, it } from 'vitest';
import { Campaigns, Companies, Contacts, repositories, WorkspaceSettings } from './collections.ts';
import { migrate } from './migrate.ts';
import { purgeWorkspace } from './purge.ts';
import { newId } from './repository.ts';

const A = newId();
const B = newId();

const company = (name: string) => ({
  name,
  normalizedName: name.toLowerCase(),
  domain: `${name.toLowerCase()}.example`,
  country: 'ID',
  sources: [{ source: 'search' as const, ref: 'q', at: new Date() }],
});

const contact = (email: string) => ({
  companyId: newId(),
  email,
  emailConfidence: 'verified' as const,
  locale: 'id' as const,
  timezone: 'Asia/Jakarta',
  status: 'new' as const,
});

beforeEach(async () => {
  await migrate();
  await Promise.all(repositories.map((r) => r.col().deleteMany({})));
});

describe('repository.purge', () => {
  it("deletes only the given workspace's documents", async () => {
    await Companies.create(A, company('Kopi'));
    await Companies.create(A, company('Teh'));
    await Companies.create(B, company('Nasi'));

    expect(await Companies.purge(A)).toBe(2);
    expect(await Companies.count(A)).toBe(0);
    expect(await Companies.count(B)).toBe(1);
  });

  it('returns zero when the workspace has nothing', async () => {
    expect(await Companies.purge(A)).toBe(0);
  });
});

describe('purgeWorkspace', () => {
  it('wipes every collection for one workspace and leaves others intact', async () => {
    await Companies.create(A, company('Kopi'));
    await Contacts.create(A, contact('a@kopi.example'));
    await Contacts.create(A, contact('b@kopi.example'));
    await WorkspaceSettings.create(A, {
      website: 'https://kopi.example',
      senderName: 'Ayu',
      homeCountry: 'ID',
      timezone: 'Asia/Jakarta',
      businessHours: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
      warmup: {},
    });
    // Another workspace that must survive.
    await Companies.create(B, company('Nasi'));
    await Contacts.create(B, contact('c@nasi.example'));

    const counts = await purgeWorkspace(A);
    expect(counts.companies).toBe(1);
    expect(counts.contacts).toBe(2);
    expect(counts.workspace_settings).toBe(1);

    expect(await Companies.count(A)).toBe(0);
    expect(await Contacts.count(A)).toBe(0);
    expect(await WorkspaceSettings.count(A)).toBe(0);
    expect(await Campaigns.count(A)).toBe(0);

    // Workspace B is untouched.
    expect(await Companies.count(B)).toBe(1);
    expect(await Contacts.count(B)).toBe(1);
  });

  it('covers every repository Sutra owns', async () => {
    const counts = await purgeWorkspace(A);
    expect(Object.keys(counts).sort()).toEqual(repositories.map((r) => r.name).sort());
  });
});
