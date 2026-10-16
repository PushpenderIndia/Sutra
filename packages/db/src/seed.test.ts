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
});
