import 'server-only';
import { PipelineNodes, PipelineRuns } from '@sutra/db';
import type { Id } from '@sutra/domain';

/** The latest pipeline run and its nodes, for the agent graph bar. */
export async function loadLatestRun(workspaceId: Id) {
  const [run] = await PipelineRuns.find(workspaceId, {}, { sort: { startedAt: -1 }, limit: 1 });
  if (!run) return null;
  const nodes = await PipelineNodes.find(
    workspaceId,
    { runId: run._id },
    { sort: { startedAt: 1 } },
  );
  return {
    id: run._id,
    status: run.status,
    nodes: nodes.map((n) => ({
      nodeId: n.nodeId,
      parentId: n.parentId,
      agent: n.agent,
      status: n.status,
      summary: n.summary,
    })),
  };
}
export type RunView = NonNullable<Awaited<ReturnType<typeof loadLatestRun>>>;
export type NodeView = RunView['nodes'][number];
