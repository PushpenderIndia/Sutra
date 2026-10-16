import 'server-only';
import { env } from '@sutra/config';
import { PipelineNodes, PipelineRuns } from '@sutra/db';
import type { Id, PipelineNode, PipelineRun } from '@sutra/domain';
import { traceLink } from '@sutra/obs';
import { AppError } from '@/lib/action';
import type { NodeState, RunState } from '@/lib/graph/model';

/** Tool calls kept per node in the graph payload (the popover shows the last 5). */
const TOOL_CALLS = 5;

const iso = (d?: Date) => d?.toISOString();

function toNodeState(n: PipelineNode): NodeState {
  return {
    nodeId: n.nodeId,
    parentId: n.parentId,
    agent: n.agent,
    status: n.status,
    summary: n.summary,
    error: n.error,
    startedAt: iso(n.startedAt),
    endedAt: iso(n.endedAt),
    updatedAt: n.updatedAt.toISOString(),
    tokens: n.tokens,
    costUsd: n.costUsd,
    toolCalls: n.toolCalls
      .slice(-TOOL_CALLS)
      .map((c) => ({ name: c.name, at: c.at.toISOString() })),
    progress: n.progress,
  };
}

/**
 * Writes are stamped before they commit and instances' clocks drift, so the next cursor trails
 * the read by this much: a late write is never missed, at worst sent twice (merged by id).
 */
const OVERLAP_MS = 2_000;

/** The run with all its nodes, or (with `after`) only those updated after it. */
async function snapshot(workspaceId: Id, run: PipelineRun, after?: Date): Promise<RunState> {
  const readAt = Date.now();
  const nodes = await PipelineNodes.find(
    workspaceId,
    { runId: run._id, ...(after && { updatedAt: { $gt: after } }) },
    { sort: { updatedAt: 1, nodeId: 1 } },
  );
  const cursor = Math.max(after?.getTime() ?? 0, readAt - OVERLAP_MS);
  return {
    id: run._id,
    status: run.status,
    cursor: new Date(cursor).toISOString(),
    full: !after,
    nodes: nodes.map(toNodeState),
    ...(run.traceId && { traceLink: traceLink(env.GCP_PROJECT_ID, run.traceId) }),
  };
}

const latest = async (workspaceId: Id) =>
  (await PipelineRuns.find(workspaceId, {}, { sort: { startedAt: -1 }, limit: 1 }))[0] ?? null;

/** The latest pipeline run with every node, for the agent graph's first render. */
export async function loadLatestRun(workspaceId: Id) {
  const run = await latest(workspaceId);
  return run && snapshot(workspaceId, run);
}

/**
 * What changed in run `runId` since `after`. If a newer run has started (onboarding, a
 * re-run) or `runId` is `latest`, returns the latest run in full so the graph switches to it.
 */
export async function loadRunChanges(workspaceId: Id, runId: Id | 'latest', after?: Date) {
  const newest = await latest(workspaceId);
  if (runId === 'latest') return newest && snapshot(workspaceId, newest);
  if (newest?._id === runId) return snapshot(workspaceId, newest, after);
  if (!(await PipelineRuns.get(workspaceId, runId)))
    throw new AppError('NOT_FOUND', 'Pipeline run not found');
  return newest && snapshot(workspaceId, newest);
}
