import { BusinessProfiles, Icps, type Input } from '@sutra/db';
import type { businessProfileDoc, Id, icpDoc } from '@sutra/domain';
import { describe, expect, it, vi } from 'vitest';
import { auth } from '@/lib/auth';
import { as, signIn, signUp } from '@/test/request';
import { confirmProfile, saveIcp, saveProfile } from './business';
import { createWorkspace } from './workspace';

vi.mock('@/lib/profiler', () => ({ startProfiler: vi.fn(async () => {}) }));

const PROFILE: Input<typeof businessProfileDoc> = {
  status: 'draft',
  version: 1,
  name: 'Flowbase',
  website: 'https://flowbase.io',
  oneLiner: 'No-code automation.',
  offerings: [{ name: 'Builder', description: 'Automation.' }],
  proofPoints: [{ text: '400+ companies', sourceUrl: 'https://flowbase.io/about' }],
  customers: [{ name: 'Northstar Bank', sourceUrl: 'https://flowbase.io/customers' }],
  geographies: ['SG'],
  differentiators: ['SOC 2'],
  competitors: [{ name: 'Zapier' }],
  toneOfVoice: 'Plain and practical.',
  sources: ['https://flowbase.io'],
};

const ICP: Input<typeof icpDoc> = {
  status: 'draft',
  version: 1,
  firmographics: {
    industries: ['Banking'],
    sizes: ['51-200'],
    countries: ['SG'],
    keywords: ['ops'],
    technologies: [],
  },
  personas: [
    {
      title: 'Head of Ops',
      altTitles: [],
      seniority: 'director',
      pains: ['manual work'],
      goals: ['speed'],
      objections: [],
    },
  ],
  buyingSignals: ['hiring'],
  disqualifiers: ['tiny'],
  rationale: 'Mid-market ops teams.',
};

async function ownerWithProfile(email: string) {
  const owner = await signUp(email);
  as(owner.headers);
  await expect(createWorkspace({ website: 'flowbase.io', timezone: 'UTC' })).rejects.toThrow(
    'NEXT_REDIRECT',
  );
  const session = await auth.api.getSession({ headers: owner.headers });
  const workspaceId = session?.session.activeOrganizationId as Id;
  await BusinessProfiles.create(workspaceId, PROFILE);
  await Icps.create(workspaceId, ICP);
  return { ...owner, workspaceId };
}

describe('business actions', () => {
  it('saves a profile edit as a new draft version, keeping other fields', async () => {
    const { workspaceId, headers } = await ownerWithProfile('p1@example.com');
    as(headers);
    expect(await saveProfile({ oneLiner: 'Workflow automation for ops teams.' })).toEqual({
      ok: true,
      data: { version: 2 },
    });
    const [latest] = await BusinessProfiles.find(
      workspaceId,
      {},
      { sort: { version: -1 }, limit: 1 },
    );
    expect(latest).toMatchObject({
      version: 2,
      status: 'draft',
      oneLiner: 'Workflow automation for ops teams.',
      name: 'Flowbase', // untouched fields carry over
    });
    expect(await BusinessProfiles.count(workspaceId, {})).toBe(2);
  });

  it('saves an ICP edit as a new version', async () => {
    const { workspaceId, headers } = await ownerWithProfile('p2@example.com');
    as(headers);
    const result = await saveIcp({ disqualifiers: ['fewer than 10 staff', 'no budget'] });
    expect(result).toMatchObject({ ok: true, data: { version: 2 } });
    const [latest] = await Icps.find(workspaceId, {}, { sort: { version: -1 }, limit: 1 });
    expect(latest?.disqualifiers).toEqual(['fewer than 10 staff', 'no budget']);
    expect(latest?.firmographics.industries).toEqual(['Banking']);
  });

  it('confirms the latest profile and ICP, but only for admins', async () => {
    const owner = await ownerWithProfile('boss@example.com');
    const member = await signUp('teammate@example.com');
    await auth.api.addMember({
      body: { userId: member.user.id, organizationId: owner.workspaceId, role: 'member' },
    });

    as(await signIn('teammate@example.com'));
    expect(await confirmProfile({})).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    as(owner.headers);
    expect(await confirmProfile({})).toEqual({ ok: true, data: { status: 'confirmed' } });
    const [profile] = await BusinessProfiles.find(
      owner.workspaceId,
      {},
      { sort: { version: -1 }, limit: 1 },
    );
    const [icpDoc] = await Icps.find(owner.workspaceId, {}, { sort: { version: -1 }, limit: 1 });
    expect(profile?.status).toBe('confirmed');
    expect(icpDoc?.status).toBe('confirmed');
  });

  it('returns NOT_FOUND when there is no profile to edit', async () => {
    const owner = await signUp('empty@example.com');
    as(owner.headers);
    await expect(createWorkspace({ website: 'empty.example', timezone: 'UTC' })).rejects.toThrow(
      'NEXT_REDIRECT',
    );
    expect(await saveProfile({ oneLiner: 'x' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
