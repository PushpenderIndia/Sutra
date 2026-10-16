import { FunctionTool } from '@google/adk';
import { newId, PipelineNodes, PipelineRuns } from '@sutra/db';
import type { Id } from '@sutra/domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { completion, mockProxy, toolCall } from '../../test/mock-proxy.ts';
import { defineAgent } from '../agent.ts';
import { runAgent } from '../run.ts';
import { definePipeline } from './define.ts';
import { resumePipeline, runPipeline, runTrigger } from './engine.ts';
import { reportProgress } from './recorder.ts';
import { MAIN_TOPOLOGY, topologyOf } from './topology.ts';

const proxy = await mockProxy();
const calls: string[] = [];

const lookup = new FunctionTool({
  name: 'lookup',
  description: 'Look up a website',
  parameters: z.object({ url: z.string() }),
  execute: async () => ({ title: 'Acme' }),
});
const profilerAgent = defineAgent({
  name: 'fake_profiler',
  model: proxy.model(),
  instruction: 'Profile.',
  tools: [lookup],
});
const writerAgent = defineAgent({
  name: 'fake_writer',
  model: proxy.model(),
  instruction: 'Write.',
});

const fake = definePipeline(
  {
    orchestrator: { label: 'Orchestrator', children: ['profiler', 'checkpoint', 'writer'] },
    profiler: {
      label: 'Profiler',
      children: ['fake_profiler'],
      run: async ({ workspaceId, runId }) => {
        calls.push('profiler');
        const { output } = await runAgent({
          agent: profilerAgent,
          workspaceId,
          sessionKey: `profile:${runId}:${calls.length}`,
          input: 'Profile acme.test',
        });
        return { summary: output };
      },
    },
    checkpoint: { label: 'You confirm profile', kind: 'human', after: ['profiler'] },
    writer: {
      label: 'Writer',
      after: ['checkpoint'],
      fanOut: () => ['email', 'linkedin'],
      run: async ({ workspaceId, item }) => {
        calls.push(`writer:${item}`);
        await runAgent({
          agent: writerAgent,
          workspaceId,
          sessionKey: `write:${item}`,
          input: 'Draft',
        });
        return { summary: `Wrote ${item}` };
      },
    },
    replies: { label: 'Reply analyst', trigger: 'reply.received', run: async () => undefined },
  },
  { name: 'fake' },
);

const nodeMap = async (ws: Id, runId: Id) =>
  Object.fromEntries((await PipelineNodes.find(ws, { runId })).map((n) => [n.nodeId, n]));
const runStatus = async (ws: Id, runId: Id) => (await PipelineRuns.get(ws, runId))?.status;

describe('pipeline engine', () => {
  it('pauses at the human node, resumes on confirm, fans out, and records sub-agents', async () => {
    const ws = newId();
    proxy.reply({
      json: completion(null, { toolCalls: [toolCall('l1', 'lookup', { url: 'acme.test' })] }),
    });
    const runId = await runPipeline(fake, ws);

    expect(await runStatus(ws, runId)).toBe('waiting_human');
    let n = await nodeMap(ws, runId);
    expect(n.orchestrator?.status).toBe('done');
    expect(n.profiler).toMatchObject({ status: 'done', summary: 'ok', tokens: 30 });
    expect(n.checkpoint?.status).toBe('waiting_human');
    expect(n.writer?.status).toBe('queued');
    expect(n.replies).toBeUndefined();
    expect(n['profiler/fake_profiler']).toMatchObject({
      parentId: 'profiler',
      agent: 'fake_profiler',
      status: 'done',
      tokens: 30,
      toolCalls: [expect.objectContaining({ name: 'lookup' })],
    });
    expect(calls).toEqual(['profiler']);

    await resumePipeline(fake, ws, 'checkpoint');
    expect(await runStatus(ws, runId)).toBe('done');
    n = await nodeMap(ws, runId);
    expect(n.checkpoint).toMatchObject({ status: 'done', summary: 'Confirmed' });
    expect(n.writer).toMatchObject({ status: 'done', summary: '2/2 done' });
    expect(n['writer.email']).toMatchObject({
      status: 'done',
      parentId: 'writer',
      summary: 'Wrote email',
    });
    expect(n['writer.linkedin/fake_writer']).toMatchObject({
      status: 'done',
      parentId: 'writer.linkedin',
    });
    expect(calls.slice(1).sort()).toEqual(['writer:email', 'writer:linkedin']);

    await expect(resumePipeline(fake, ws, 'checkpoint')).rejects.toThrow(/not waiting/);
  });

  it('re-running from a node invalidates everything downstream', async () => {
    const ws = newId();
    const runId = await runPipeline(fake, ws);
    await resumePipeline(fake, ws, 'checkpoint');
    expect(await runStatus(ws, runId)).toBe('done');

    calls.length = 0;
    expect(await runPipeline(fake, ws, 'profiler')).toBe(runId);
    expect(calls).toEqual(['profiler']);
    expect(await runStatus(ws, runId)).toBe('waiting_human');
    const n = await nodeMap(ws, runId);
    expect(n.orchestrator?.status).toBe('done');
    expect(n.checkpoint?.status).toBe('waiting_human');
    expect(n.writer).toMatchObject({ status: 'queued', tokens: 0 });
    expect(n.writer?.summary).toBeUndefined();
    expect(n['writer.email']).toBeUndefined();
    expect(n['writer.email/fake_writer']).toBeUndefined();
  });

  it('marks the node and run failed when a node throws', async () => {
    const ws = newId();
    const failing = definePipeline(
      {
        first: { label: 'First', run: async () => ({ summary: 'fine' }) },
        boom: {
          label: 'Boom',
          after: ['first'],
          run: async () => {
            throw new Error('source unavailable');
          },
        },
        last: { label: 'Last', after: ['boom'], run: async () => undefined },
      },
      { name: 'failing' },
    );
    const runId = await runPipeline(failing, ws);
    expect(await runStatus(ws, runId)).toBe('failed');
    const n = await nodeMap(ws, runId);
    expect(n.boom).toMatchObject({ status: 'failed', error: 'source unavailable' });
    expect(n.last?.status).toBe('queued');
  });

  it('records live progress and event-driven trigger runs on the latest run', async () => {
    const ws = newId();
    const live = definePipeline(
      {
        sources: {
          label: 'Sources',
          fanOut: () => ['search'],
          run: async () => {
            await reportProgress(12);
            await reportProgress(148);
            return { summary: '148 companies' };
          },
        },
        scorer: {
          label: 'Scorer',
          after: ['sources'],
          run: async () => {
            await reportProgress(87, 148);
            return undefined;
          },
        },
        replies: {
          label: 'Reply analyst',
          trigger: 'reply.received',
          run: async ({ item }) => ({ summary: `meeting_request from ${item}` }),
        },
      },
      { name: 'live' },
    );
    expect(await runTrigger(live, ws, 'replies', 'Acme')).toEqual({
      summary: 'meeting_request from Acme',
    });
    const runId = await runPipeline(live, ws);
    const before = await nodeMap(ws, runId);
    expect(before['sources.search']).toMatchObject({ progress: { done: 148 } });
    expect(before.scorer).toMatchObject({ progress: { done: 87, total: 148 } });
    expect(before.replies).toBeUndefined();

    await runTrigger(live, ws, 'replies', 'Kopi Kenangan');
    const fired = (await nodeMap(ws, runId)).replies;
    expect(fired).toMatchObject({ status: 'done', summary: 'meeting_request from Kopi Kenangan' });
    expect(fired?.updatedAt.getTime()).toBeGreaterThan(before.scorer?.updatedAt.getTime() ?? 0);
    await expect(runTrigger(live, ws, 'scorer')).rejects.toThrow(/not a trigger/);
  });

  it('exposes a JSON-safe topology without run functions', () => {
    const t = topologyOf(fake);
    expect(t.writer).toEqual({ label: 'Writer', after: ['checkpoint'], fanOut: true });
    expect(t.replies).toEqual({ label: 'Reply analyst', trigger: 'reply.received' });
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
    expect(topologyOf({ nodes: MAIN_TOPOLOGY })).toEqual(MAIN_TOPOLOGY);
  });

  it('rejects invalid definitions', () => {
    expect(() =>
      definePipeline(
        { a: { label: 'A', after: ['b'] }, b: { label: 'B', after: ['a'] } },
        { name: 'x' },
      ),
    ).toThrow(/cycle/);
    expect(() =>
      // @ts-expect-error unknown dependency
      definePipeline({ a: { label: 'A', after: ['nope'] } }, { name: 'y' }),
    ).toThrow(/unknown/);
    expect(() =>
      definePipeline(
        { h: { label: 'H', kind: 'human', run: async () => undefined } },
        { name: 'z' },
      ),
    ).toThrow(/Human node/);
    expect(fake.downstream('profiler')).toEqual(['checkpoint', 'writer']);
    expect(fake.order).not.toContain('replies');
  });
});
