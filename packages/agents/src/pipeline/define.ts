import type { Id } from '@sutra/domain';

export type NodeContext = {
  workspaceId: Id;
  runId: Id;
  /** `pipeline_nodes.nodeId`: the node id, or `node.item` for a fan-out child. */
  nodeId: string;
  /** The fan-out item (e.g. a lead source) this child handles. */
  item?: string;
};
export type NodeResult = { summary?: string } | undefined;

export interface NodeDef<K extends string = string> {
  label: string;
  /** `human` nodes pause the run until `resumePipeline` (confirm / approve). */
  kind?: 'agent' | 'human';
  /** Sub-agents shown under this node in the graph; recorded automatically when they run. */
  children?: readonly string[];
  /** Nodes that must be done first. */
  after?: readonly K[];
  /** Runs `run` once per returned item, in parallel, as child nodes. */
  fanOut?: (ctx: NodeContext) => readonly string[] | Promise<readonly string[]>;
  run?: (ctx: NodeContext) => Promise<NodeResult | undefined>;
  /** Event-driven nodes (`reply.received`, `cron`) run outside the main walk. */
  trigger?: string;
}

export interface Pipeline<K extends string = string> {
  name: string;
  nodes: Readonly<Record<K, NodeDef<K>>>;
  /** Nodes the walk visits (everything without a `trigger`), in dependency order. */
  order: readonly K[];
  /** Every node that transitively depends on `id`. */
  downstream(id: K): K[];
}

const pipelines = new Map<string, Pipeline>();
export const getPipeline = (name: string) => {
  const p = pipelines.get(name);
  if (!p) throw new Error(`Unknown pipeline "${name}"`);
  return p;
};

/**
 * Declares the autonomous flow as a graph. The same object drives `runPipeline` and the live
 * agent graph (PR 17). Throws on unknown dependencies, cycles or contradictory node kinds.
 */
export function definePipeline<const K extends string>(
  nodes: Record<K, NodeDef<NoInfer<K>>>,
  { name = 'main' }: { name?: string } = {},
): Pipeline<K> {
  const ids = Object.keys(nodes) as K[];
  const def = (id: K) => nodes[id];
  for (const id of ids) {
    const n = def(id);
    for (const dep of n.after ?? [])
      if (!(dep in nodes)) throw new Error(`Pipeline node "${id}" depends on unknown "${dep}"`);
    if (n.kind === 'human' && (n.run || n.fanOut))
      throw new Error(`Human node "${id}" cannot have run or fanOut`);
    if (n.fanOut && !n.run) throw new Error(`Fan-out node "${id}" needs a run function`);
    if (n.trigger && n.after?.length) throw new Error(`Trigger node "${id}" cannot have after`);
  }

  const order: K[] = [];
  const state = new Map<K, 'visiting' | 'done'>();
  const visit = (id: K, path: K[]) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting')
      throw new Error(`Pipeline cycle: ${[...path, id].join(' → ')}`);
    state.set(id, 'visiting');
    for (const dep of def(id).after ?? []) visit(dep, [...path, id]);
    state.set(id, 'done');
    order.push(id);
  };
  for (const id of ids) if (!def(id).trigger) visit(id, []);

  const downstream = (id: K): K[] => {
    const found = new Set<K>();
    const walk = (from: K) => {
      for (const other of order)
        if (def(other).after?.includes(from) && !found.has(other)) {
          found.add(other);
          walk(other);
        }
    };
    walk(id);
    return order.filter((o) => found.has(o));
  };

  const pipeline: Pipeline<K> = { name, nodes, order, downstream };
  pipelines.set(name, pipeline as Pipeline);
  return pipeline;
}
