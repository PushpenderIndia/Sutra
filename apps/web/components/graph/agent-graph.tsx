'use client';
import type { Topology } from '@sutra/agents/topology';
import { ChevronDown, Maximize2, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import { LiveDot } from '@/components/live-dot';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { CHECKPOINT_HREF } from '@/lib/graph/links';
import { buildGraph, type Graph, type GraphNode, type RunState } from '@/lib/graph/model';
import { useNodeLabel } from '@/lib/graph/use-labels';
import { cn } from '@/lib/utils';
import {
  GraphContext,
  type GraphEnv,
  StatusIcon,
  TRIGGER_ICON,
  useGraph,
  useLiveLine,
} from './parts';

// React Flow and dagre load only when the graph is opened.
const GraphCanvas = dynamic(() => import('./graph-canvas'), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse rounded-lg bg-muted/40" />,
});

const NO_FLASH: ReadonlySet<string> = new Set();

export type AgentGraphProps = {
  run: RunState | null;
  topology: Topology;
  /** Clock for durations and relative times. */
  now: number;
  flashing?: ReadonlySet<string>;
  onRerun?: (nodeId: string) => unknown;
  /** `overlay` drops the expanded graph under the app header; `inline` renders it in place. */
  variant?: 'overlay' | 'inline';
  defaultExpanded?: boolean;
};

/** The graph with the orchestrator reflecting the whole run's status. */
function graphOf(topology: Topology, run: RunState | null): Graph {
  const graph = buildGraph(topology, run?.nodes ?? []);
  if (!graph.root || !run) return graph;
  return { ...graph, root: { ...graph.root, status: run.status } };
}

/**
 * The live agent graph: one pill per stage in the top bar (one summary pill on mobile), and on
 * click the full graph of agents, sub-agents and fan-out sources. A pure render of the run.
 */
export function AgentGraph({
  run,
  topology,
  now,
  flashing = NO_FLASH,
  onRerun,
  variant = 'overlay',
  defaultExpanded = false,
}: AgentGraphProps) {
  const t = useTranslations('graph');
  const graph = useMemo(() => graphOf(topology, run), [topology, run]);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [fullScreen, setFullScreen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const panelId = useId();
  const env: GraphEnv = {
    nodes: run?.nodes ?? [],
    children: graph.children,
    now,
    flashing,
    onRerun,
    traceLink: run?.traceLink,
    openId,
    setOpenId,
  };

  useEffect(() => {
    if (!expanded || variant === 'inline') return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && !openId && setExpanded(false);
    // Capture phase: runs before an open popover handles (and closes on) the same Escape.
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [expanded, variant, openId]);

  const canvas = (
    <div className="relative size-full">
      <GraphCanvas graph={graph} />
    </div>
  );

  return (
    <GraphContext value={env}>
      <section aria-label={t('label')} className="flex min-w-0 items-center">
        <MobilePill graph={graph} run={run} onOpen={() => setFullScreen(true)} />
        <StagePills
          graph={graph}
          expanded={expanded}
          panelId={panelId}
          onToggle={() => setExpanded((e) => !e)}
        />
      </section>

      {expanded && variant === 'overlay' && (
        <button
          type="button"
          aria-label={t('collapse')}
          tabIndex={-1}
          className="fixed inset-x-0 top-14 bottom-0 z-30 hidden cursor-default bg-background/50 backdrop-blur-[2px] motion-safe:animate-in motion-safe:fade-in-0 md:block"
          onClick={() => setExpanded(false)}
        />
      )}
      {expanded && (
        <div
          id={panelId}
          className={cn(
            'flex-col border-b bg-background',
            variant === 'overlay'
              ? 'fixed inset-x-0 top-14 hidden md:flex z-40 h-[min(380px,60dvh)] shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2'
              : 'flex h-[400px] rounded-xl border',
          )}
        >
          <PanelHeader
            run={run}
            onFullScreen={() => setFullScreen(true)}
            onClose={variant === 'overlay' ? () => setExpanded(false) : undefined}
          />
          <div className="min-h-0 flex-1">{canvas}</div>
        </div>
      )}

      <Dialog open={fullScreen} onOpenChange={setFullScreen}>
        <DialogContent className="flex h-[88dvh] w-[calc(100vw-1.5rem)] max-w-none flex-col gap-0 p-0 sm:max-w-none">
          <DialogTitle className="sr-only">{t('title')}</DialogTitle>
          <DialogDescription className="sr-only">{t('description')}</DialogDescription>
          <PanelHeader run={run} />
          <div className="min-h-0 flex-1">{fullScreen && canvas}</div>
        </DialogContent>
      </Dialog>
    </GraphContext>
  );
}

function PanelHeader({
  run,
  onFullScreen,
  onClose,
}: {
  run: RunState | null;
  onFullScreen?: () => void;
  onClose?: () => void;
}) {
  const t = useTranslations('graph');
  return (
    <div className="flex items-center gap-3 border-b px-4 py-2 pr-12 md:pr-4">
      <h2 className="font-medium">{t('title')}</h2>
      {run ? (
        <StatusBadge status={run.status} />
      ) : (
        <span className="text-xs text-muted-foreground">{t('notStarted')}</span>
      )}
      <Legend />
      <div className="ml-auto flex items-center gap-1">
        {onFullScreen && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('fullScreen')}
            onClick={onFullScreen}
          >
            <Maximize2 aria-hidden />
          </Button>
        )}
        {onClose && (
          <Button variant="ghost" size="icon-sm" aria-label={t('collapse')} onClick={onClose}>
            <X aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

function Legend() {
  const t = useTranslations('graph');
  return (
    <ul className="hidden items-center gap-3 text-xs text-muted-foreground lg:flex">
      {(['running', 'waiting_human', 'done', 'queued'] as const).map((s) => (
        <li key={s} className="flex items-center gap-1">
          <StatusIcon status={s} className="size-3 motion-safe:animate-none" />
          {t(`status.${s}`)}
        </li>
      ))}
    </ul>
  );
}

/** Stage → stage pills, then the event-driven agents; the running one says what it is doing. */
function StagePills({
  graph,
  expanded,
  panelId,
  onToggle,
}: {
  graph: Graph;
  expanded: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  const t = useTranslations('graph');
  return (
    <div className="hidden min-w-0 items-center gap-1 md:flex">
      <ol className="flex min-w-0 items-center overflow-x-auto py-1 [scrollbar-width:none]">
        {graph.stages.map((n, i) => (
          <Fragment key={n.id}>
            {i > 0 && <li aria-hidden className="h-px w-1.5 shrink-0 bg-border 2xl:w-3" />}
            <li className="shrink-0">
              <Pill node={n} expanded={expanded} panelId={panelId} onToggle={onToggle} />
            </li>
          </Fragment>
        ))}
        {graph.triggers.length > 0 && (
          <li aria-hidden className="mx-1 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
        )}
        {graph.triggers.map((n) => (
          <li key={n.id} className="shrink-0">
            <Pill node={n} expanded={expanded} panelId={panelId} onToggle={onToggle} />
          </li>
        ))}
      </ol>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={expanded ? t('collapse') : t('expand')}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="shrink-0"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            'transition-transform motion-reduce:transition-none',
            expanded && 'rotate-180',
          )}
        />
      </Button>
    </div>
  );
}

function Pill({
  node,
  expanded,
  panelId,
  onToggle,
}: {
  node: GraphNode;
  expanded: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  const t = useTranslations('graph');
  const label = useNodeLabel();
  const line = useLiveLine();
  const { children, flashing } = useGraph();
  const flash = flashing.has(node.id);
  const waiting = node.status === 'waiting_human';
  const active = node.status === 'running' || waiting || flash;
  // Finished stages and idle event agents shrink to an icon until there is room (2xl).
  const compact = !active && (node.status === 'done' || node.role === 'trigger');
  const TriggerIcon = node.role === 'trigger' && !active ? TRIGGER_ICON[node.id] : undefined;
  const name = label(node, { short: true });
  const className = cn(
    'flex h-7 max-w-64 items-center gap-1.5 rounded-full border text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none',
    node.status === 'running' && 'border-saffron/70 bg-saffron/12 motion-safe:animate-glow',
    waiting && 'border-saffron bg-saffron font-medium text-neutral-950 motion-safe:animate-glow',
    flash && 'border-saffron motion-safe:animate-flash',
    node.status === 'done' && !flash && 'bg-card hover:bg-accent',
    node.status === 'failed' && 'border-rose-500/50 text-rose-700 dark:text-rose-300',
    node.role === 'trigger' && !active && 'border-dashed text-muted-foreground hover:bg-accent',
    node.status === 'queued' &&
      node.role !== 'trigger' &&
      'border-dashed text-muted-foreground hover:bg-accent',
    compact ? 'px-2 2xl:px-2.5' : 'px-2 2xl:px-2.5',
  );
  const body = (
    <>
      {TriggerIcon ? (
        <TriggerIcon aria-hidden className="size-3.5 shrink-0" />
      ) : node.status === 'queued' && node.role === 'stage' ? null : (
        <StatusIcon
          status={
            node.role === 'human' && !waiting && node.status !== 'done'
              ? 'waiting_human'
              : node.status
          }
          className={cn(
            'size-3',
            waiting && 'text-neutral-950',
            node.role === 'human' && node.status === 'queued' && 'text-muted-foreground/70',
          )}
        />
      )}
      <span className={cn(active && 'font-medium', compact && 'sr-only 2xl:not-sr-only')}>
        {name}
      </span>
      {active && (
        <span className={cn('min-w-0 truncate', !waiting && 'text-muted-foreground')}>
          · {line(node, children[node.id])}
        </span>
      )}
      <span className="sr-only">: {t(`status.${node.status}`)}</span>
    </>
  );
  if (waiting && CHECKPOINT_HREF[node.id])
    return (
      <Link
        href={CHECKPOINT_HREF[node.id] ?? '/'}
        className={className}
        title={t('openCheckpoint')}
      >
        {body}
      </Link>
    );
  return (
    <button
      type="button"
      className={className}
      title={compact ? name : undefined}
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={onToggle}
    >
      {body}
    </button>
  );
}

/** Mobile: one pill naming what is running; opens the graph full screen. */
function MobilePill({
  graph,
  run,
  onOpen,
}: {
  graph: Graph;
  run: RunState | null;
  onOpen: () => void;
}) {
  const t = useTranslations('graph');
  const label = useNodeLabel();
  const current =
    [...graph.stages, ...graph.triggers].find((n) => n.status === 'running') ??
    graph.stages.find((n) => n.status === 'waiting_human');
  const live = Boolean(current);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-w-0 items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs whitespace-nowrap md:hidden"
    >
      <LiveDot live={live} tone={live ? 'accent' : run ? 'success' : 'muted'} />
      <span className="truncate">
        {current
          ? current.status === 'waiting_human'
            ? t('waiting')
            : t('running', { agent: label(current, { short: true }) })
          : run
            ? t('idle')
            : t('notStarted')}
      </span>
    </button>
  );
}
