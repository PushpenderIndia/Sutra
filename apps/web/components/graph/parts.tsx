'use client';
import type { PipelineNodeStatus } from '@sutra/domain';
import {
  Check,
  CircleDashed,
  FlaskConical,
  Hand,
  LoaderCircle,
  MessageSquareReply,
  Minus,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, useContext } from 'react';
import { fanOutTotals, type GraphNode, type NodeState } from '@/lib/graph/model';
import { useNodeLabel } from '@/lib/graph/use-labels';
import { cn } from '@/lib/utils';

/** What every node of the graph (bar, canvas, popover) needs besides itself. */
export type GraphEnv = {
  nodes: readonly NodeState[];
  children: Readonly<Record<string, GraphNode[]>>;
  /** The clock durations are measured against (the replay's own clock in a replay). */
  now: number;
  /** Event-driven nodes that just fired. */
  flashing: ReadonlySet<string>;
  /** Shows "re-run from here" (admins). */
  onRerun?: (nodeId: string) => unknown;
  /** Cloud Trace link for the run, so each node popover can open its full trace (PR 18). */
  traceLink?: string;
  openId: string | null;
  setOpenId: (id: string | null) => void;
};

export const GraphContext = createContext<GraphEnv | null>(null);
export function useGraph() {
  const env = useContext(GraphContext);
  if (!env) throw new Error('useGraph() outside <GraphContext>');
  return env;
}

/** Icons of the event-driven agents. */
export const TRIGGER_ICON: Record<string, typeof FlaskConical> = {
  replyAnalyst: MessageSquareReply,
  optimizer: FlaskConical,
};

const ICON = {
  running: LoaderCircle,
  done: Check,
  failed: X,
  waiting_human: Hand,
  skipped: Minus,
  queued: CircleDashed,
} as const;

/** Spinner while running; a check that pops in once done (no motion when reduced). */
export function StatusIcon({
  status,
  className,
}: {
  status: PipelineNodeStatus;
  className?: string;
}) {
  const Icon = ICON[status];
  return (
    <Icon
      key={status}
      aria-hidden
      className={cn(
        'size-3.5 shrink-0',
        status === 'running' && 'text-saffron-ink motion-safe:animate-spin',
        status === 'done' && 'text-emerald-600 motion-safe:animate-pop dark:text-emerald-400',
        status === 'failed' && 'text-rose-600 dark:text-rose-400',
        status === 'waiting_human' && 'text-saffron-ink',
        (status === 'queued' || status === 'skipped') && 'text-muted-foreground/70',
        className,
      )}
    />
  );
}

/** The one-line "what is it doing" under a node: live counts while running, else its summary. */
export function useLiveLine() {
  const t = useTranslations('graph');
  const label = useNodeLabel();
  return (n: GraphNode, children: readonly GraphNode[] = []): string => {
    const s = n.state;
    if (n.role === 'human') {
      if (n.status === 'waiting_human') return t('waiting');
      return n.status === 'done' ? (s?.summary ?? t('status.done')) : t('status.queued');
    }
    if (n.status === 'running') {
      const { items, found } = fanOutTotals(children);
      if (items) return t('fanOutSummary', { sources: items, count: found });
      if (s?.progress?.total) return t('progress', s.progress);
      if (s?.progress) return t('found', { count: s.progress.done });
      const active = children.find((c) => c.status === 'running');
      if (active) return label(active);
      return s?.summary ?? t('status.running');
    }
    if (n.status === 'failed') return s?.error ?? t('status.failed');
    return s?.summary ?? t(`status.${n.status}`);
  };
}

/** A thin progress bar (`done` of `total`). */
export function Meter({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  return (
    <span
      aria-hidden
      className={cn('block h-1 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <span
        className="block h-full rounded-full bg-saffron transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}
