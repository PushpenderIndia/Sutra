import { seedDemo, DEMO_WORKSPACE_ID as ws } from '@sutra/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { LEAD_BUCKETS } from '@/lib/leads';
import { loadBusiness } from './business';
import { loadCampaigns } from './campaigns';
import { loadLeads, loadThread } from './leads';
import { loadLatestRun } from './pipeline';
import { loadProspects } from './prospects';

beforeAll(async () => {
  await seedDemo({ now: new Date('2026-10-01T00:00:00Z') });
});

describe('tab loaders on the demo seed', () => {
  it('business: confirmed profile and ICP', async () => {
    const { profile, icp } = await loadBusiness(ws);
    expect(profile).toMatchObject({ name: 'PixelPress', status: 'confirmed' });
    expect(icp?.personas).toHaveLength(2);
  });

  it('prospects: every company, best score first, with contacts', async () => {
    const rows = await loadProspects(ws);
    expect(rows).toHaveLength(16);
    expect(rows[0]).toMatchObject({ name: 'Kopi Nusantara', score: 92, fit: 'strong' });
    expect(rows.every((r) => r.contacts.length === 2)).toBe(true);
    expect(rows[1]?.sources).toEqual(['search', 'lookalike']);
  });

  it('campaigns: per-variant stats add up to the messages sent', async () => {
    const [campaign] = await loadCampaigns(ws);
    const variants = campaign?.steps.flatMap((s) => s.variants) ?? [];
    expect(variants.map((v) => v.letter)).toEqual(['A', 'B', 'C', 'A', 'B', 'A']);
    expect(variants.find((v) => v.status === 'pending_approval')?.stats.sent).toBe(0);
    const sent = variants.reduce((n, v) => n + v.stats.sent, 0);
    const replies = variants.reduce((n, v) => n + v.stats.replies, 0);
    expect(sent).toBeGreaterThan(32);
    expect(replies).toBeGreaterThan(0);
  });

  it('leads: every contact lands in exactly one card, with attribution', async () => {
    const rows = await loadLeads(ws);
    expect(rows).toHaveLength(32);
    const counts = LEAD_BUCKETS.map((b) => rows.filter((r) => r.bucket === b).length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(32);
    expect(rows.filter((r) => r.bucket === 'meeting_booked').every((r) => r.meetingAt)).toBe(true);
    const replied = rows.filter((r) => r.intent);
    expect(replied.length).toBeGreaterThan(0);
    expect(replied.every((r) => r.step && r.variant && r.summary)).toBe(true);
  });

  it('thread: outbound and inbound in order, with the analysis', async () => {
    const lead = (await loadLeads(ws)).find((r) => r.intent);
    const thread = await loadThread(ws, lead?.id ?? '');
    expect(thread.messages.at(0)?.direction).toBe('outbound');
    expect(thread.messages.at(-1)).toMatchObject({
      direction: 'inbound',
      analysis: { intent: lead?.intent },
    });
  });

  it('pipeline: the latest run and its stages', async () => {
    const run = await loadLatestRun(ws);
    expect(run?.nodes.map((n) => n.nodeId)).toContain('checkpoint1');
    expect(await loadLatestRun('000000000000000000000000')).toBeNull();
  });
});
