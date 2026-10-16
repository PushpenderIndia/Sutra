import { type Contact, contactTransitions } from '@sutra/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { audit } from './audit.ts';
import { AuditEvents, Companies, Contacts } from './collections.ts';
import { InvalidTransitionError } from './errors.ts';
import { migrate } from './migrate.ts';
import { newId } from './repository.ts';

const A = newId();
const B = newId();
const input = (
  email: string,
): Omit<Contact, '_id' | 'workspaceId' | 'createdAt' | 'updatedAt'> => ({
  companyId: newId(),
  email,
  emailConfidence: 'verified',
  locale: 'id',
  timezone: 'Asia/Jakarta',
  status: 'new',
});

beforeEach(async () => {
  await migrate();
  await Contacts.col().deleteMany({});
});

describe('repository', () => {
  it('stamps ids, workspace and dates, and validates on create', async () => {
    const c = await Contacts.create(A, input('Ayu@Kopi.example'));
    expect(c._id).toMatch(/^[a-f0-9]{24}$/);
    expect(c).toMatchObject({ workspaceId: A, email: 'ayu@kopi.example' });
    expect(c.createdAt).toBeInstanceOf(Date);
    await expect(Contacts.create(A, input('not-an-email'))).rejects.toThrow();
    await expect(Contacts.create('nope', input('x@y.example'))).rejects.toThrow();
  });

  it("never reads or writes another workspace's documents", async () => {
    const mine = await Contacts.create(A, input('a@kopi.example'));
    await Contacts.create(B, input('b@kopi.example'));

    expect(await Contacts.get(B, mine._id)).toBeNull();
    expect(await Contacts.get(A, mine._id)).toMatchObject({ _id: mine._id });
    // A workspaceId smuggled into the filter is overridden by the scope.
    expect(await Contacts.find(B, { workspaceId: A } as never)).toHaveLength(1);
    expect((await Contacts.find(B)).map((c) => c.email)).toEqual(['b@kopi.example']);
    expect(await Contacts.findOne(B, { _id: mine._id })).toBeNull();
    expect(await Contacts.count(B, { email: 'a@kopi.example' })).toBe(0);
    expect(await Contacts.update(B, mine._id, { title: 'hacked' })).toBeNull();
    expect(
      await Contacts.transition(B, mine._id, 'new', 'contacted', contactTransitions),
    ).toBeNull();
    expect(await Contacts.remove(B, mine._id)).toBe(false);
    expect(await Contacts.get(A, mine._id)).toMatchObject({ status: 'new' });
    expect((await Contacts.get(A, mine._id))?.title).toBeUndefined();
  });

  it('validates patches, keeps base fields immutable and unsets undefined keys', async () => {
    const c = await Contacts.create(A, { ...input('a@kopi.example'), title: 'Ops' });
    await expect(Contacts.update(A, c._id, { email: 'bad' })).rejects.toThrow();
    const moved = await Contacts.update(A, c._id, {
      title: undefined,
      name: 'Ayu',
      workspaceId: B,
    } as never);
    expect(moved).toMatchObject({ workspaceId: A, name: 'Ayu' });
    expect(moved?.title).toBeUndefined();
    expect(moved?.updatedAt.getTime()).toBeGreaterThanOrEqual(c.updatedAt.getTime());
  });

  it('throws on a transition the table does not allow', async () => {
    const c = await Contacts.create(A, input('a@kopi.example'));
    await expect(
      Contacts.transition(A, c._id, 'new', 'meeting_booked', contactTransitions),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(
      await Contacts.transition(A, c._id, 'contacted', 'engaged', contactTransitions),
    ).toBeNull();
  });

  it('lets exactly one of many concurrent transitions win', async () => {
    const c = await Contacts.create(A, input('a@kopi.example'));
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        Contacts.transition(A, c._id, 'new', 'contacted', contactTransitions, { title: 'won' }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await Contacts.get(A, c._id)).toMatchObject({ status: 'contacted', title: 'won' });
  });

  it('upserts by key within the workspace', async () => {
    const company = {
      name: 'Kopi',
      normalizedName: 'kopi',
      domain: 'kopi.example',
      country: 'ID',
      sources: [{ source: 'search' as const, ref: 'q', at: new Date() }],
    };
    const first = await Companies.upsertBy(A, 'domain', company);
    const again = await Companies.upsertBy(A, 'domain', { ...company, city: 'Jakarta' });
    const other = await Companies.upsertBy(B, 'domain', company);
    expect(again._id).toBe(first._id);
    expect(again.createdAt).toEqual(first.createdAt);
    expect(again.city).toBe('Jakarta');
    expect(other._id).not.toBe(first._id);
    expect(await Companies.count(A)).toBe(1);
  });

  it('records audit events', async () => {
    await audit(A, { kind: 'agent', id: 'scorer' }, 'company.score', {
      entity: 'companies',
      entityId: newId(),
      data: { score: 80 },
    });
    const [event] = await AuditEvents.find(A, { action: 'company.score' });
    expect(event).toMatchObject({ actor: { kind: 'agent' }, data: { score: 80 } });
    expect(await AuditEvents.count(B)).toBe(0);
  });
});
