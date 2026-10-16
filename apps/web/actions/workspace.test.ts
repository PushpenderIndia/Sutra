import { WorkspaceSettings } from '@sutra/db';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { route } from '@/lib/action';
import { auth } from '@/lib/auth';
import { as, signIn, signUp } from '@/test/request';
import { createWorkspace, updateComplianceOverrides } from './workspace';

// Onboarding kicks off the profiler pipeline; that is covered in @sutra/agents, not here.
vi.mock('@/lib/profiler', () => ({ startProfiler: vi.fn(async () => {}) }));

const overrides = { complianceOverrides: { ID: { requireUnsubscribe: true } } };

async function ownerWithWorkspace(email: string, website = 'www.acme-labs.co.id') {
  const owner = await signUp(email);
  as(owner.headers);
  await expect(createWorkspace({ website, timezone: 'Asia/Jakarta' })).rejects.toThrow(
    'NEXT_REDIRECT',
  );
  const session = await auth.api.getSession({ headers: owner.headers });
  const workspaceId = session?.session.activeOrganizationId;
  if (!workspaceId) throw new Error('no active workspace');
  return { ...owner, workspaceId };
}

describe('workspace actions', () => {
  it('reject anonymous callers', async () => {
    as();
    expect(await createWorkspace({ website: 'acme.com' })).toMatchObject({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(await updateComplianceOverrides(overrides)).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('onboarding creates a named workspace with settings, owned by the user', async () => {
    const { workspaceId, headers } = await ownerWithWorkspace('owner@example.com');
    const org = await auth.api.getFullOrganization({ headers });
    expect(org?.name).toBe('Acme Labs');
    expect(JSON.parse(org?.metadata)).toEqual({ website: 'https://www.acme-labs.co.id' });
    expect(org?.members).toMatchObject([{ role: 'owner' }]);
    expect(await WorkspaceSettings.findOne(workspaceId, {})).toMatchObject({
      website: 'https://www.acme-labs.co.id',
      homeCountry: 'ID',
      timezone: 'Asia/Jakarta',
      dailySendCap: 150,
    });
  });

  it('validates input', async () => {
    as((await signUp('typo@example.com')).headers);
    expect(await createWorkspace({ website: 'not a website' })).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
  });

  it('requires a workspace for workspace actions and lets only admins change compliance', async () => {
    const owner = await ownerWithWorkspace('boss@example.com', 'boss.sg');
    const member = await signUp('member@example.com');

    as(member.headers);
    expect(await updateComplianceOverrides(overrides)).toMatchObject({ code: 'NO_WORKSPACE' });

    await auth.api.addMember({
      body: { userId: member.user.id, organizationId: owner.workspaceId, role: 'member' },
    });
    // A fresh sign-in lands in the user's first workspace.
    as(await signIn('member@example.com'));
    const result = await updateComplianceOverrides(overrides);
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect((await WorkspaceSettings.findOne(owner.workspaceId, {}))?.complianceOverrides).toEqual(
      {},
    );

    as(owner.headers);
    expect(await updateComplianceOverrides(overrides)).toEqual({
      ok: true,
      data: overrides.complianceOverrides,
    });
  });

  it('route() guards route handlers the same way', async () => {
    const GET = route(z.object({ q: z.string() }), async ({ workspaceId, role }, { q }) => ({
      workspaceId,
      role,
      q,
    }));
    const url = 'http://localhost:3000/api/x?q=hi';
    expect((await GET(new Request(url))).status).toBe(401);

    const owner = await ownerWithWorkspace('route@example.com', 'route.example');
    const ok = await GET(new Request(url, { headers: owner.headers }));
    expect(await ok.json()).toEqual({ workspaceId: owner.workspaceId, role: 'owner', q: 'hi' });
    const bad = await GET(new Request('http://localhost:3000/api/x', { headers: owner.headers }));
    expect(bad.status).toBe(400);
  });
});
