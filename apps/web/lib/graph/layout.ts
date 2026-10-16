import dagre from '@dagrejs/dagre';
import type { Graph, GraphRole } from './model';

export type Box = { x: number; y: number; width: number; height: number };

/** Fixed node sizes, so the layout never depends on rendered text. */
export const SIZE: Record<GraphRole, { width: number; height: number }> = {
  root: { width: 132, height: 56 },
  stage: { width: 164, height: 60 },
  human: { width: 124, height: 60 },
  trigger: { width: 176, height: 56 },
  child: { width: 148, height: 34 },
  placeholder: { width: 148, height: 34 },
};
const CHILD_INDENT = 16;
const CHILD_GAP = 8;
const CHILD_TOP = 22;

/**
 * Left-to-right positions: dagre places the main chain and the side nodes; each stage's
 * sub-agents hang below it in a column. Deterministic for the same graph.
 */
export function layoutGraph(graph: Graph): Record<string, Box> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 14, ranksep: 36, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const spine = [...(graph.root ? [graph.root] : []), ...graph.stages, ...graph.triggers];
  for (const n of spine) g.setNode(n.id, { ...SIZE[n.role] });
  for (const e of graph.edges) if (e.kind !== 'child') g.setEdge(e.source, e.target);
  dagre.layout(g);

  const boxes: Record<string, Box> = {};
  for (const n of spine) {
    const { x, y, width, height } = g.node(n.id);
    boxes[n.id] = { x: Math.round(x - width / 2), y: Math.round(y - height / 2), width, height };
  }
  for (const [stage, list] of Object.entries(graph.children)) {
    const parent = boxes[stage];
    if (!parent) continue;
    list.forEach((c, i) => {
      const size = SIZE[c.role];
      boxes[c.id] = {
        x: parent.x + CHILD_INDENT,
        y: parent.y + parent.height + CHILD_TOP + i * (size.height + CHILD_GAP),
        ...size,
      };
    });
  }
  return boxes;
}
