import type { Topology } from '@sutra/agents/topology';
import type { PipelineNodeStatus, PipelineRunStatus } from '@sutra/domain';

/** One `pipeline_nodes` doc as the graph sees it (JSON: dates are ISO strings). */
export type NodeState = {
  nodeId: string;
  parentId?: string;
  agent: string;
  status: PipelineNodeStatus;
  summary?: string;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
  tokens: number;
  costUsd: number;
  toolCalls: { name: string; at: string }[];
  progress?: { done: number; total?: number };
};

/** A run as `GET /api/pipeline/[runId]` returns it: all nodes (`full`) or the changed ones. */
export type RunState = {
  id: string;
  status: PipelineRunStatus;
  /** Pass back as `?after=` to get only what changed since. */
  cursor: string;
  full: boolean;
  nodes: NodeState[];
};

export type GraphRole = 'root' | 'stage' | 'human' | 'child' | 'trigger' | 'placeholder';

export type GraphNode = {
  /** The `pipeline_nodes.nodeId` this draws (`profiler`, `profiler/crawler`, `prospector.search`). */
  id: string;
  role: GraphRole;
  /** The topology id, sub-agent or fan-out item name: what labels are looked up by. */
  name: string;
  /** Topology label, the fallback when there is no translation. */
  label: string;
  /** For children: the stage they belong to. */
  stage?: string;
  /** For children: a fan-out item (e.g. a lead source) rather than a sub-agent. */
  item?: boolean;
  status: PipelineNodeStatus;
  state?: NodeState;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: 'flow' | 'child' | 'trigger';
};

export type Graph = {
  root?: GraphNode;
  stages: GraphNode[];
  children: Record<string, GraphNode[]>;
  triggers: GraphNode[];
  edges: GraphEdge[];
};

/** Topology ids in dependency order (key order breaks ties), as `definePipeline` walks them. */
export function walkOrder(topology: Topology): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id) || !topology[id]) return;
    seen.add(id);
    for (const dep of topology[id].after ?? []) visit(dep);
    order.push(id);
  };
  for (const id of Object.keys(topology)) if (!topology[id]?.trigger) visit(id);
  return order;
}

const byStart = (a: NodeState, b: NodeState) =>
  (a.startedAt ?? a.updatedAt).localeCompare(b.startedAt ?? b.updatedAt) ||
  a.nodeId.localeCompare(b.nodeId);

/**
 * The graph to draw: the topology's stages (fixed, so the layout never jumps), their declared
 * sub-agents plus any recorded ones, fan-out children from the live run, and event-driven side
 * nodes. A pure function of its inputs.
 */
export function buildGraph(topology: Topology, nodes: readonly NodeState[]): Graph {
  const live = new Map(nodes.map((n) => [n.nodeId, n]));
  const ids = new Set(Object.keys(topology));
  const node = (id: string, role: GraphRole, name: string, label: string): GraphNode => {
    const state = live.get(id);
    return { id, role, name, label, status: state?.status ?? 'queued', ...(state && { state }) };
  };

  const order = walkOrder(topology);
  // A root (the orchestrator) groups other top-level nodes rather than having sub-agents.
  const rootId = order.find((id) => topology[id]?.children?.some((c) => ids.has(c)));
  const stageIds = order.filter((id) => id !== rootId);
  // Recorded top-level nodes the topology doesn't know (yet) go at the end, in start order.
  for (const n of [...live.values()].sort(byStart))
    if (!ids.has(n.nodeId) && (!n.parentId || n.parentId === rootId) && !/[./]/.test(n.nodeId))
      stageIds.push(n.nodeId);

  const stages = stageIds.map((id) => {
    const t = topology[id];
    return node(id, t?.kind === 'human' ? 'human' : 'stage', id, t?.label ?? id);
  });
  const triggers = Object.keys(topology)
    .filter((id) => topology[id]?.trigger)
    .map((id) => node(id, 'trigger', id, topology[id]?.label ?? id));

  const children: Record<string, GraphNode[]> = {};
  for (const { id } of stages) {
    const t = topology[id];
    const declared = (t?.children ?? []).map((c) => node(`${id}/${c}`, 'child', c, c));
    const recorded = [...live.values()]
      .filter((n) => n.parentId === id && !declared.some((d) => d.id === n.nodeId))
      .sort(byStart)
      .map((n) => ({
        ...node(n.nodeId, 'child', n.agent, n.agent),
        ...(n.nodeId.startsWith(`${id}.`) && { item: true }),
      }));
    const list = [...declared, ...recorded].map((c) => ({ ...c, stage: id }));
    if (t?.fanOut && !list.some((c) => c.item))
      list.unshift({ ...node(`${id}.*`, 'placeholder', 'fanOut', ''), stage: id });
    if (list.length) children[id] = list;
  }

  const edges: GraphEdge[] = [];
  const edge = (source: string, target: string, kind: GraphEdge['kind']) =>
    edges.push({ id: `${source}->${target}`, source, target, kind });
  const root = rootId ? node(rootId, 'root', rootId, topology[rootId]?.label ?? rootId) : undefined;
  stages.forEach((s, i) => {
    const after = topology[s.id]?.after?.filter((d) => stageIds.includes(d));
    const previous = stageIds[i - 1];
    if (after?.length) for (const d of after) edge(d, s.id, 'flow');
    else if (root && topology[s.id]) edge(root.id, s.id, 'flow');
    else if (previous) edge(previous, s.id, 'flow');
  });
  for (const [stage, list] of Object.entries(children))
    for (const c of list) edge(stage, c.id, 'child');
  const last = stages.at(-1);
  if (last) for (const t of triggers) edge(last.id, t.id, 'trigger');

  return { ...(root && { root }), stages, children, triggers, edges };
}

/** Folds a poll response into the current run. */
export function mergeRun(current: RunState | null, next: RunState | null): RunState | null {
  if (!next) return null;
  if (!current || next.full || current.id !== next.id) return next;
  const nodes = new Map(current.nodes.map((n) => [n.nodeId, n]));
  for (const n of next.nodes) {
    // Re-running from a node deletes its fan-out children and sub-agents (they can't appear
    // in a diff), so a node reset to queued drops its descendants here too.
    if (n.status === 'queued' && nodes.get(n.nodeId)?.status !== 'queued')
      for (const id of nodes.keys())
        if (id.startsWith(`${n.nodeId}.`) || id.startsWith(`${n.nodeId}/`)) nodes.delete(id);
    nodes.set(n.nodeId, n);
  }
  return { ...next, full: false, nodes: [...nodes.values()] };
}

/** Whether to poll fast: the run or an event-driven node is working. */
export const isActive = (run: RunState | null) =>
  run?.status === 'running' || Boolean(run?.nodes.some((n) => n.status === 'running'));

/** Sum of fan-out results, and how many items, under a stage. */
export function fanOutTotals(list: readonly GraphNode[] = []) {
  const items = list.filter((c) => c.item);
  return {
    items: items.length,
    found: items.reduce((sum, c) => sum + (c.state?.progress?.done ?? 0), 0),
  };
}

/** Milliseconds the node has run (until `now` while it is still running). */
export function durationMs(state: NodeState | undefined, now: number) {
  if (!state?.startedAt) return undefined;
  const end = state.endedAt ? Date.parse(state.endedAt) : now;
  return Math.max(0, end - Date.parse(state.startedAt));
}

/** Tool calls of a node and everything under it, newest first. */
export function recentToolCalls(nodes: readonly NodeState[], id: string, limit = 5) {
  return nodes
    .filter(
      (n) => n.nodeId === id || n.nodeId.startsWith(`${id}.`) || n.nodeId.startsWith(`${id}/`),
    )
    .flatMap((n) => n.toolCalls.map((c) => ({ ...c, agent: n.agent })))
    .sort((a, b) => b.at.localeCompare(a.at) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** `profileWriter` → `Profile writer`, for agents without a translated label. */
export const humanize = (name: string) =>
  name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
