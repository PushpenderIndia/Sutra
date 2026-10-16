import type { GraphNode } from './model';

/** Where each human checkpoint lives. */
export const CHECKPOINT_HREF: Record<string, string> = {
  checkpoint1: '/business',
  checkpoint2: '/campaigns',
};

/** The tab showing each stage's output. */
const OUTPUT_HREF: Record<string, string> = {
  profiler: '/business',
  prospector: '/prospects',
  enricher: '/prospects',
  copywriter: '/campaigns',
  sender: '/campaigns',
  replyAnalyst: '/leads',
  optimizer: '/campaigns',
};

/** "View output" for a node: a fan-out source filters Prospects to what it found. */
export function outputHref(n: GraphNode): string | undefined {
  if (n.role === 'human') return CHECKPOINT_HREF[n.id];
  if (n.item && n.stage === 'prospector') return `/prospects?source=${encodeURIComponent(n.name)}`;
  return OUTPUT_HREF[n.stage ?? n.id];
}
