import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { db } from './client.ts';
import {
  BusinessProfiles,
  Campaigns,
  Contacts,
  Meetings,
  Messages,
  Replies,
  TrackingEvents,
} from './collections.ts';
import { migrate } from './migrate.ts';
import { DEMO_WORKSPACE_ID, seedDemo } from './seed.ts';

const ws = DEMO_WORKSPACE_ID;

describe('seedDemo', () => {
  it('builds a realistic, valid demo workspace and resets it on re-run', async () => {
    await migrate();
    const first = await seedDemo();
    const totals = async () => ({
      contacts: await Contacts.count(ws),
      messages: await Messages.count(ws),
      replies: await Replies.count(ws),
      meetings: await Meetings.count(ws),
    });
    const before = await totals();
    expect(await seedDemo()).toEqual(first);
    expect(await totals()).toEqual(before);

    expect(await BusinessProfiles.findOne(ws, { status: 'confirmed' })).not.toBeNull();
    const [campaign] = await Campaigns.find(ws, { status: 'running' });
    expect(campaign?.steps.length).toBeGreaterThanOrEqual(3);
    expect(campaign?.steps[0]?.variants.some((v) => v.status === 'pending_approval')).toBe(true);
    expect(before.replies).toBeGreaterThan(0);
    expect(before.meetings).toBeGreaterThan(0);
    expect(await TrackingEvents.count(ws, { kind: 'open', machine: false })).toBeGreaterThan(0);

    // Per-variant stats come out of the data.
    const stats = await Messages.col()
      .aggregate([
        { $match: { workspaceId: ws, direction: 'outbound', stepIndex: 0 } },
        { $group: { _id: '$variantId', sent: { $sum: 1 } } },
      ])
      .toArray();
    expect(stats).toHaveLength(2);

    const { dataSize, indexSize } = await db().stats();
    expect(dataSize + indexSize).toBeLessThan(5 * 1024 * 1024);
  });

  it('links the demo workspace to a Better Auth organization and owner', async () => {
    const _id = new ObjectId(ws);
    expect(await db().collection('organization').findOne({ _id })).toMatchObject({
      slug: 'pixelpress-demo',
    });
    await expect(seedDemo({ ownerEmail: 'nobody@example.com' })).rejects.toThrow(/sign in once/);

    const user = await db().collection('user').insertOne({ email: 'mei@example.com' });
    expect((await seedDemo({ ownerEmail: 'Mei@example.com' })).owner).toBe('Mei@example.com');
    await seedDemo({ ownerEmail: 'mei@example.com' });
    const members = await db().collection('member').find({ organizationId: _id }).toArray();
    expect(members).toMatchObject([{ userId: user.insertedId, role: 'owner' }]);
  });
});
