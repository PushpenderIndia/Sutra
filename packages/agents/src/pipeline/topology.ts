/**
 * The pipeline's shape without its run functions: JSON-safe and free of ADK imports, so the
 * web client can draw the agent graph from it (`@sutra/agents/topology`).
 */
export type TopologyNode = {
  label: string;
  kind?: 'agent' | 'human';
  children?: readonly string[];
  after?: readonly string[];
  /** Fans out at run time (one child per item, e.g. per lead source). */
  fanOut?: boolean;
  trigger?: string;
};
export type Topology = Readonly<Record<string, TopologyNode>>;

type Definable = {
  nodes: Readonly<Record<string, Omit<TopologyNode, 'fanOut'> & { fanOut?: unknown }>>;
};

/** Strips a pipeline definition down to its topology. */
export function topologyOf({ nodes }: Definable): Topology {
  return Object.fromEntries(
    Object.entries(nodes).map(([id, n]) => {
      const { label, kind, children, after, trigger } = n;
      const fanOut = Boolean(n.fanOut);
      return [
        id,
        {
          label,
          ...(kind && { kind }),
          ...(children?.length && { children: [...children] }),
          ...(after?.length && { after: [...after] }),
          ...(fanOut && { fanOut }),
          ...(trigger && { trigger }),
        },
      ];
    }),
  );
}

/** The planned main pipeline (PR 06 §7): what the graph shows before a run and in replays. */
export const MAIN_TOPOLOGY = {
  orchestrator: {
    label: 'Orchestrator',
    children: ['profiler', 'prospector', 'enricher', 'copywriter', 'sender', 'optimizer'],
  },
  profiler: { label: 'Business Profiler', children: ['crawler', 'webResearch', 'icpBuilder'] },
  checkpoint1: { label: 'You confirm profile', kind: 'human', after: ['profiler'] },
  prospector: { label: 'Prospector', after: ['checkpoint1'], fanOut: true },
  enricher: {
    label: 'Enricher & Scorer',
    after: ['prospector'],
    children: ['contactFinder', 'researcher', 'scorer'],
  },
  copywriter: {
    label: 'Copywriter',
    after: ['enricher'],
    children: ['sequencePlanner', 'variantWriter', 'qualityGate'],
  },
  checkpoint2: { label: 'You approve campaign', kind: 'human', after: ['copywriter'] },
  sender: {
    label: 'Sender',
    after: ['checkpoint2'],
    children: ['compliance', 'scheduler', 'gmail'],
  },
  replyAnalyst: { label: 'Reply Analyst', trigger: 'reply.received' },
  optimizer: { label: 'A/B Optimizer', trigger: 'cron' },
} as const satisfies Topology;
