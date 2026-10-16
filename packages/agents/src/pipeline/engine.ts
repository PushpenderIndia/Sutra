import { newId, PipelineNodes, PipelineRuns } from '@sutra/db';
import type { Id, PipelineNodeStatus, PipelineRunStatus } from '@sutra/domain';
import { log, newTraceId, tracer, withCorrelation } from '@sutra/obs';
import { defineJob, dispatch } from '../jobs.ts';
import { getPipeline, type NodeContext, type Pipeline } from './define.ts';
import { nodeScope } from './recorder.ts';

const NODE_JOB = 'pipeline.node';
type NodeJob = { pipeline: string; workspaceId: Id; runId: Id; nodeId: string; item?: string };

const nodes = () => PipelineNodes.col();
const TERMINAL: PipelineNodeStatus[] = ['done', 'failed', 'skipped'];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Fan-out children and sub-agent docs of the given nodes: `id.item`, `id/agent`, `id.item/agent`. */
const descendantsOf = (ids: string[]) => new RegExp(`^(${ids.map(escapeRe).join('|')})[./]`);

export const latestRun = async (workspaceId: Id) =>
  (await PipelineRuns.find(workspaceId, {}, { sort: { startedAt: -1 }, limit: 1 }))[0] ?? null;

async function statuses(workspaceId: Id, runId: Id) {
  const docs = await PipelineNodes.find(workspaceId, { runId, parentId: { $exists: false } });
  return new Map(docs.map((d) => [d.nodeId, d.status]));
}

/** Moves a node doc `from → to` atomically; returns false if another worker got there first. */
async function move(
  key: { workspaceId: Id; runId: Id; nodeId: string },
  from: PipelineNodeStatus | PipelineNodeStatus[],
  to: PipelineNodeStatus,
  extra: Record<string, unknown> = {},
) {
  const now = new Date();
  const res = await nodes().updateOne(
    { ...key, status: { $in: [from].flat() } },
    {
      $set: {
        status: to,
        updatedAt: now,
        ...(to === 'running' && { startedAt: now }),
        ...(TERMINAL.includes(to) && { endedAt: now }),
        ...extra,
      },
    },
  );
  return res.modifiedCount === 1;
}

/** Queued nodes whose dependencies are all done. */
const readyNodes = (p: Pipeline, s: Map<string, PipelineNodeStatus>) =>
  p.order.filter(
    (id) => s.get(id) === 'queued' && (p.nodes[id]?.after ?? []).every((d) => s.get(d) === 'done'),
  );

function deriveRunStatus(p: Pipeline, s: Map<string, PipelineNodeStatus>): PipelineRunStatus {
  const all = p.order.map((id) => s.get(id));
  if (all.every((x) => x === 'done' || x === 'skipped')) return 'done';
  if (all.includes('running')) return 'running';
  if (readyNodes(p, s).length) return 'running';
  if (all.includes('failed')) return 'failed';
  if (all.includes('waiting_human')) return 'waiting_human';
  return 'running';
}

/** Starts every node whose dependencies are done, then updates the run's status. */
async function advance(p: Pipeline, workspaceId: Id, runId: Id) {
  const ready = readyNodes(p, await statuses(workspaceId, runId));
  await Promise.all(
    ready.map((nodeId) =>
      p.nodes[nodeId]?.kind === 'human'
        ? move({ workspaceId, runId, nodeId }, 'queued', 'waiting_human')
        : dispatch(NODE_JOB, { pipeline: p.name, workspaceId, runId, nodeId } satisfies NodeJob),
    ),
  );
  const status = deriveRunStatus(p, await statuses(workspaceId, runId));
  const terminal = status === 'done' || status === 'failed';
  await PipelineRuns.update(workspaceId, runId, {
    status,
    endedAt: terminal ? new Date() : undefined,
  });
}

/** When the last fan-out child finishes, closes the parent and continues the walk. */
async function closeFanOut(p: Pipeline, job: NodeJob) {
  const { workspaceId, runId, nodeId } = job;
  const children = await PipelineNodes.find(workspaceId, {
    runId,
    parentId: nodeId,
    nodeId: { $regex: `^${escapeRe(nodeId)}\\.[^/]+$` },
  });
  if (children.some((c) => !TERMINAL.includes(c.status))) return;
  const failed = children.filter((c) => c.status === 'failed').length;
  const summary = `${children.length - failed}/${children.length} done`;
  if (
    await move({ workspaceId, runId, nodeId }, 'running', failed ? 'failed' : 'done', { summary })
  )
    await advance(p, workspaceId, runId);
}

async function runNode(payload: Record<string, unknown>) {
  const job = payload as NodeJob;
  const p = getPipeline(job.pipeline);
  const def = p.nodes[job.nodeId];
  if (!def) throw new Error(`Pipeline "${p.name}" has no node "${job.nodeId}"`);
  const { workspaceId, runId, item } = job;
  const docId = item === undefined ? job.nodeId : `${job.nodeId}.${item}`;
  const key = { workspaceId, runId, nodeId: docId };
  if (!(await move(key, 'queued', 'running'))) return;
  const ctx: NodeContext = {
    workspaceId,
    runId,
    nodeId: docId,
    ...(item !== undefined && { item }),
  };

  // Join the run's trace so every node span (and the agent/LLM spans beneath it) and every log line
  // share the run's correlation ids and trace id (PR 18). The default tracer/logger are no-ops.
  const run = await PipelineRuns.get(workspaceId, runId);
  await withCorrelation({ workspaceId, runId, nodeId: docId, traceId: run?.traceId }, () =>
    tracer().withSpan(`node:${docId}`, () => runNodeBody(p, def, job, ctx, key)),
  );
}

async function runNodeBody(
  p: Pipeline,
  def: NonNullable<Pipeline['nodes'][string]>,
  job: NodeJob,
  ctx: NodeContext,
  key: { workspaceId: Id; runId: Id; nodeId: string },
) {
  const { workspaceId, runId, item } = job;
  const docId = key.nodeId;
  try {
    if (def.fanOut && item === undefined) {
      const items = [...new Set(await def.fanOut(ctx))];
      if (items.length) {
        await PipelineNodes.createMany(
          workspaceId,
          items.map((i) => ({
            runId,
            nodeId: `${docId}.${i}`,
            parentId: docId,
            agent: i,
            status: 'queued' as const,
          })),
        );
        await Promise.all(items.map((i) => dispatch(NODE_JOB, { ...job, item: i })));
        return;
      }
      await move(key, 'running', 'done', { summary: 'Nothing to fan out' });
    } else {
      const { run } = def;
      const result = run ? await nodeScope.run(key, () => run(ctx)) : undefined;
      await move(key, 'running', 'done', result?.summary ? { summary: result.summary } : {});
    }
  } catch (error) {
    await move(key, 'running', 'failed', { error: (error as Error).message });
    log().error('node.failed', { node: docId, error: (error as Error).message });
    // Sub-agents that were mid-run when the node failed.
    await nodes().updateMany(
      { workspaceId, runId, parentId: docId, status: 'running' },
      { $set: { status: 'failed', endedAt: new Date(), updatedAt: new Date() } },
    );
  }
  if (item !== undefined) await closeFanOut(p, job);
  else await advance(p, workspaceId, runId);
}
defineJob(NODE_JOB, runNode);

/**
 * Runs the pipeline for a workspace. With `from`, re-runs the latest run from that node:
 * it and every downstream node go back to `queued` (their results are invalidated) while
 * upstream results are kept. Returns the run id; the run pauses at human nodes.
 */
export async function runPipeline<K extends string>(p: Pipeline<K>, workspaceId: Id, from?: K) {
  if (from && !p.order.includes(from)) throw new Error(`Cannot run from "${from}"`);
  const previous = from ? await latestRun(workspaceId) : null;
  let runId: Id;
  if (previous && from) {
    runId = previous._id;
    const reset = [from, ...p.downstream(from)];
    await nodes().deleteMany({ workspaceId, runId, nodeId: descendantsOf(reset) });
    await nodes().updateMany(
      { workspaceId, runId, nodeId: { $in: reset } },
      {
        $set: { status: 'queued', tokens: 0, costUsd: 0, toolCalls: [], updatedAt: new Date() },
        $unset: { summary: '', error: '', startedAt: '', endedAt: '', progress: '' },
      },
    );
    await PipelineRuns.update(workspaceId, runId, { status: 'running', from, endedAt: undefined });
  } else {
    const run = await PipelineRuns.create(workspaceId, {
      status: 'running',
      from,
      traceId: newTraceId(),
      startedAt: new Date(),
    });
    runId = run._id;
    await PipelineNodes.createMany(
      workspaceId,
      p.order.map((nodeId) => ({ runId, nodeId, agent: nodeId, status: 'queued' as const })),
    );
  }
  await advance(p as Pipeline, workspaceId, runId);
  return runId;
}

/** Completes a waiting human node (the user confirmed or approved) and continues the run. */
export async function resumePipeline<K extends string>(
  p: Pipeline<K>,
  workspaceId: Id,
  nodeId: K,
  summary = 'Confirmed',
) {
  const run = await latestRun(workspaceId);
  if (
    !run ||
    !(await move({ workspaceId, runId: run._id, nodeId }, 'waiting_human', 'done', { summary }))
  )
    throw new Error(`Pipeline node "${nodeId}" is not waiting for a person`);
  await advance(p as Pipeline, workspaceId, run._id);
  return run._id;
}

/**
 * Runs an event-driven node (`trigger`, e.g. the reply analyst on `reply.received`) and records
 * it on the latest run, so the agent graph flashes it with its summary. Returns the result.
 */
export async function runTrigger<K extends string>(
  p: Pipeline<K>,
  workspaceId: Id,
  nodeId: K,
  item?: string,
) {
  const def = p.nodes[nodeId];
  const exec = def?.trigger ? def.run : undefined;
  if (!exec) throw new Error(`"${nodeId}" is not a trigger node`);
  const run = await latestRun(workspaceId);
  const ctx: NodeContext = { workspaceId, runId: run?._id ?? '', nodeId, ...(item && { item }) };
  if (!run) return exec(ctx);
  const key = { workspaceId, runId: run._id, nodeId };
  const now = new Date();
  await nodes().updateOne(
    key,
    {
      $set: { status: 'running', startedAt: now, updatedAt: now, toolCalls: [] },
      $unset: { endedAt: '', summary: '', error: '' },
      $setOnInsert: { _id: newId(), agent: nodeId, tokens: 0, costUsd: 0, createdAt: now },
    },
    { upsert: true },
  );
  try {
    const result = await withCorrelation(
      { workspaceId, runId: run._id, nodeId, traceId: run.traceId },
      () => tracer().withSpan(`trigger:${nodeId}`, () => nodeScope.run(key, () => exec(ctx))),
    );
    await move(key, 'running', 'done', result?.summary ? { summary: result.summary } : {});
    return result;
  } catch (error) {
    await move(key, 'running', 'failed', { error: (error as Error).message });
    log().error('trigger.failed', { node: nodeId, error: (error as Error).message });
    throw error;
  }
}
