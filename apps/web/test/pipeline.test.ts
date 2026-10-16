import { definePipeline, runPipeline } from '@sutra/agents';
import { AuditEvents, PipelineNodes, PipelineRuns } from '@sutra/db';
import type { Id } from '@sutra/domain';
import { describe, expect, it, vi } from 'vitest';
import { rerunFrom } from '@/actions/pipeline';
import { createWorkspace } from '@/actions/workspace';
import { GET } from '@/app/api/pipeline/[runId]/route';
import { auth } from '@/lib/auth';
import type { RunState } from '@/lib/graph/model';
import { as, signIn, signUp } from './request';

// Background work after the response (`after()`) starts at once in tests; `settled()` awaits it.
const background = vi.hoisted(() => [] as unknown[]);
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (task: () => unknown) => background.push(task()),
}));
const settled = () => Promise.all(background.splice(0));

const calls: string[] = [];
const record = (name: string) => async () => {
  calls.push(name);
  return { summary: name };
};
const main = definePipeline(
  {
    first: { label: 'First', run: record('first') },
    second: { label: 'Second', after: ['first'], run: record('second') },
    gate: { label: 'You', kind: 'human', after: ['second'] },
  },
  { name: 'main' },
);

async function owner(email: string) {
  const user = await signUp(email);
  as(user.headers);
  await expect(createWorkspace({ website: `${email.split('@')[0]}.example` })).rejects.toThrow(
    'NEXT_REDIRECT',
  );
  const session = await auth.api.getSession({ headers: user.headers });
  return { ...user, workspaceId: session?.session.activeOrganizationId as Id };
}

const get = async (headers: Headers, runId: string, after?: string) => {
  const query = after ? `?after=${encodeURIComponent(after)}` : '';
  const res = await GET(new Request(`http://x/api/pipeline/${runId}${query}`, { headers }), {
    params: Promise.resolve({ runId }),
  });
  return { status: res.status, body: (await res.json()) as RunState | null };
};

const ago = (ms: number) => new Date(Date.now() - ms);

async function seedRun(ws: Id, startedAt = ago(60_000)) {
  const run = await PipelineRuns.create(ws, { status: 'running', startedAt });
  await PipelineNodes.createMany(ws, [
    { runId: run._id, nodeId: 'profiler', agent: 'profiler', status: 'running' },
    {
      runId: run._id,
      nodeId: 'profiler/crawler',
      parentId: 'profiler',
      agent: 'crawler',
      status: 'done',
    },
    { runId: run._id, nodeId: 'checkpoint1', agent: 'checkpoint1', status: 'queued' },
  ]);
  // As if written a minute ago.
  await PipelineNodes.col().updateMany(
    { workspaceId: ws, runId: run._id },
    { $set: { updatedAt: ago(60_000) } },
  );
  return run._id;
}

describe('GET /api/pipeline/[runId]', () => {
  it('is guarded by route(): anonymous 401, no workspace 403, bad input 400', async () => {
    expect((await get(new Headers(), 'latest')).status).toBe(401);
    const lonely = await signUp('lonely@example.com');
    expect((await get(lonely.headers, 'latest')).status).toBe(403);
    const { headers } = await owner('guard@example.com');
    expect((await get(headers, 'not-an-id')).status).toBe(400);
    expect((await get(headers, 'latest', 'yesterday')).status).toBe(400);
  });

  it('returns the full run, then only the nodes changed since the cursor', async () => {
    const { headers, workspaceId: ws } = await owner('diff@example.com');
    expect((await get(headers, 'latest')).body).toBeNull();
    const runId = await seedRun(ws);

    const full = (await get(headers, 'latest')).body;
    expect(full).toMatchObject({ id: runId, status: 'running', full: true });
    expect(full?.nodes.map((n) => n.nodeId).sort()).toEqual([
      'checkpoint1',
      'profiler',
      'profiler/crawler',
    ]);
    expect((await get(headers, runId, full?.cursor)).body?.nodes).toEqual([]);

    const profiler = await PipelineNodes.findOne(ws, { runId, nodeId: 'profiler' });
    await PipelineNodes.update(ws, profiler?._id as Id, { status: 'done', summary: 'PixelPress' });
    const diff = (await get(headers, runId, full?.cursor)).body;
    expect(diff).toMatchObject({ id: runId, full: false });
    expect(diff?.nodes).toEqual([
      expect.objectContaining({ nodeId: 'profiler', status: 'done', summary: 'PixelPress' }),
    ]);
    expect(Date.parse(diff?.cursor ?? '')).toBeGreaterThanOrEqual(Date.parse(full?.cursor ?? ''));
  });

  it("switches to a newer run in full and hides other workspaces' runs", async () => {
    const a = await owner('a@example.com');
    const b = await owner('b@example.com');
    const old = await seedRun(a.workspaceId, ago(120_000));
    const newer = await seedRun(a.workspaceId, ago(1_000));
    const res = (await get(a.headers, old, new Date().toISOString())).body;
    expect(res).toMatchObject({ id: newer, full: true });
    expect(res?.nodes).toHaveLength(3);
    expect((await get(b.headers, old)).status).toBe(404);
  });
});

describe('rerunFrom', () => {
  it('lets admins re-run the main pipeline from an agent node', async () => {
    const boss = await owner('boss@example.com');
    const member = await signUp('member@example.com');
    await auth.api.addMember({
      body: { userId: member.user.id, organizationId: boss.workspaceId, role: 'member' },
    });
    as(await signIn('member@example.com'));
    expect(await rerunFrom({ nodeId: 'first' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    as(boss.headers);
    const runId = await runPipeline(main, boss.workspaceId);
    calls.length = 0;
    expect(await rerunFrom({ nodeId: 'gate' })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await rerunFrom({ nodeId: 'nope' })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await rerunFrom({ nodeId: 'second' })).toEqual({ ok: true, data: { nodeId: 'second' } });
    await settled();
    expect(calls).toEqual(['second']);
    expect(await PipelineRuns.get(boss.workspaceId, runId)).toMatchObject({
      status: 'waiting_human',
      from: 'second',
    });
    expect(await AuditEvents.count(boss.workspaceId, { action: 'pipeline.rerun' })).toBe(1);
  });
});
