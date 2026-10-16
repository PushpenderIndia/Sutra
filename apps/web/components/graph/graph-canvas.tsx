'use client';
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
import { FlaskConical, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { layoutGraph, SIZE } from '@/lib/graph/layout';
import { CHECKPOINT_HREF } from '@/lib/graph/links';
import type { Graph, GraphNode } from '@/lib/graph/model';
import { useNodeLabel } from '@/lib/graph/use-labels';
import { cn } from '@/lib/utils';
import { NodeDetails } from './node-details';
import { Meter, StatusIcon, TRIGGER_ICON, useGraph, useLiveLine } from './parts';

type Data = { node: GraphNode };
type FlowNode = Node<Data>;

const hidden = '!size-1 !min-w-0 !border-0 !bg-transparent';

/** Invisible connection points: in on the left, out on the right, sub-agents out of the bottom. */
function Ports({ kids = false }: { kids?: boolean }) {
  return (
    <>
      <Handle type="target" position={Position.Left} className={hidden} isConnectable={false} />
      <Handle type="source" position={Position.Right} className={hidden} isConnectable={false} />
      {kids && (
        <Handle
          id="kids"
          type="source"
          position={Position.Bottom}
          className={hidden}
          style={{ left: 10 }}
          isConnectable={false}
        />
      )}
    </>
  );
}

/** The clickable node body; opens the node popover. */
function Detailed({
  node,
  className,
  children,
}: {
  node: GraphNode;
  className?: string;
  children: React.ReactNode;
}) {
  const { openId, setOpenId } = useGraph();
  const label = useNodeLabel();
  return (
    <Popover open={openId === node.id} onOpenChange={(o) => setOpenId(o ? node.id : null)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label(node)}
          className={cn(
            'nopan relative flex size-full items-center gap-2 overflow-hidden border text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
            className,
          )}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80">
        <NodeDetails node={node} />
      </PopoverContent>
    </Popover>
  );
}

const tone = (n: GraphNode) =>
  cn(
    n.status === 'running' &&
      'border-saffron/70 bg-linear-to-br from-saffron/14 to-card motion-safe:animate-glow',
    n.status === 'done' && 'border-border bg-card',
    n.status === 'failed' && 'border-rose-500/50 bg-rose-500/5',
    (n.status === 'queued' || n.status === 'skipped') &&
      'border-dashed bg-card/60 text-muted-foreground',
  );

function StageNode({ data: { node } }: NodeProps<FlowNode>) {
  const label = useNodeLabel();
  const line = useLiveLine();
  const { children } = useGraph();
  const kids = children[node.id];
  const progress = node.state?.progress;
  return (
    <div style={SIZE.stage}>
      <Ports kids={Boolean(kids?.length)} />
      <Detailed node={node} className={cn('rounded-xl px-3 hover:bg-accent/60', tone(node))}>
        <StatusIcon status={node.status} className="size-4" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium text-foreground">{label(node)}</span>
          <span className="truncate text-[11px] text-muted-foreground">{line(node, kids)}</span>
        </span>
        {progress?.total && node.status === 'running' ? (
          <Meter
            done={progress.done}
            total={progress.total}
            className="absolute inset-x-3 bottom-1.5 w-auto"
          />
        ) : null}
      </Detailed>
    </div>
  );
}

/** A checkpoint: "Waiting for you" while it blocks the run; clicking jumps to it. */
function HumanNode({ data: { node } }: NodeProps<FlowNode>) {
  const label = useNodeLabel();
  const line = useLiveLine();
  const waiting = node.status === 'waiting_human';
  return (
    <div style={SIZE.human}>
      <Ports />
      <Link
        href={CHECKPOINT_HREF[node.id] ?? '/business'}
        className={cn(
          'nopan flex size-full flex-col items-center justify-center gap-0.5 rounded-full border px-3 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
          waiting
            ? 'border-saffron bg-saffron text-neutral-950 motion-safe:animate-glow'
            : node.status === 'done'
              ? 'border-emerald-500/40 bg-emerald-500/8'
              : 'border-dashed bg-card/60 text-muted-foreground',
        )}
      >
        <span className="flex items-center gap-1 text-[12px] font-medium">
          <StatusIcon
            status={node.status === 'done' ? 'done' : 'waiting_human'}
            className={cn(
              waiting ? 'text-neutral-950' : node.status !== 'done' && 'text-muted-foreground/70',
            )}
          />
          {label(node)}
        </span>
        <span
          className={cn('max-w-full truncate text-[10px]', !waiting && 'text-muted-foreground')}
        >
          {line(node)}
        </span>
      </Link>
    </div>
  );
}

function RootNode({ data: { node } }: NodeProps<FlowNode>) {
  const label = useNodeLabel();
  const line = useLiveLine();
  return (
    <div style={SIZE.root}>
      <Ports />
      <Detailed
        node={node}
        className="rounded-xl border-primary bg-primary px-3 text-primary-foreground"
      >
        <Workflow aria-hidden className="size-4 shrink-0 text-saffron" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium">{label(node)}</span>
          <span className="truncate text-[11px] opacity-70">{line(node)}</span>
        </span>
      </Detailed>
    </div>
  );
}

function ChildNode({ data: { node } }: NodeProps<FlowNode>) {
  const label = useNodeLabel();
  const progress = node.state?.progress;
  const size = SIZE[node.role];
  if (node.role === 'placeholder')
    return (
      <div style={size}>
        <Ports />
        <div className="flex size-full items-center rounded-lg border border-dashed px-2.5 text-[11px] text-muted-foreground">
          {label(node)}
        </div>
      </div>
    );
  return (
    <div style={size}>
      <Ports />
      <Detailed
        node={node}
        className={cn(
          'rounded-lg px-2.5 text-[12px] hover:bg-accent/60',
          tone(node),
          node.status === 'running' &&
            'motion-safe:animate-shimmer bg-[linear-gradient(110deg,transparent_30%,color-mix(in_oklch,var(--saffron)_18%,transparent)_50%,transparent_70%)] bg-size-[200%_100%]',
        )}
      >
        <StatusIcon status={node.status} className="size-3" />
        <span className="min-w-0 flex-1 truncate text-foreground">{label(node)}</span>
        {progress && !progress.total && (
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 text-[11px] font-medium tabular-nums',
              node.status === 'running' ? 'bg-saffron/20 text-saffron-ink' : 'bg-muted',
            )}
          >
            {progress.done}
          </span>
        )}
        {progress?.total ? (
          <Meter done={progress.done} total={progress.total} className="w-10 shrink-0" />
        ) : null}
      </Detailed>
    </div>
  );
}

/** Event-driven side node: flashes with its summary whenever it fires. */
function TriggerNode({ data: { node } }: NodeProps<FlowNode>) {
  const label = useNodeLabel();
  const line = useLiveLine();
  const { flashing } = useGraph();
  const Icon = TRIGGER_ICON[node.id] ?? FlaskConical;
  const lit = flashing.has(node.id) || node.status === 'running';
  return (
    <div style={SIZE.trigger}>
      <Ports />
      <Detailed
        node={node}
        className={cn(
          'rounded-xl border-dashed bg-card px-3 hover:bg-accent/60',
          lit && 'border-solid border-saffron',
          flashing.has(node.id) && 'motion-safe:animate-flash',
        )}
      >
        <Icon
          aria-hidden
          className={cn('size-4 shrink-0', lit ? 'text-saffron-ink' : 'text-muted-foreground')}
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-medium">{label(node)}</span>
          <span className="truncate text-[11px] text-muted-foreground">
            {node.state ? line(node) : '–'}
          </span>
        </span>
      </Detailed>
    </div>
  );
}

const nodeTypes = {
  root: RootNode,
  stage: StageNode,
  human: HumanNode,
  child: ChildNode,
  placeholder: ChildNode,
  trigger: TriggerNode,
};

const FIT = { padding: 0.12, maxZoom: 1.1 };

/** The active stage (running or waiting, else the first not done), its sub-agents and neighbours. */
function focusIds(graph: Graph) {
  const i = graph.stages.findIndex((s) => s.status === 'running' || s.status === 'waiting_human');
  const at = i >= 0 ? i : graph.stages.findIndex((s) => s.status !== 'done');
  if (at < 0) return [];
  return graph.stages
    .slice(Math.max(0, at - 1), at + 2)
    .flatMap((s) => [s.id, ...(graph.children[s.id] ?? []).map((c) => c.id)]);
}

const COLOR = { live: 'var(--saffron)', done: 'var(--muted-foreground)', idle: 'var(--border)' };

/** The expanded agent graph: React Flow, laid out by dagre, read-only. */
export default function GraphCanvas({ graph }: { graph: Graph }) {
  const { flashing } = useGraph();
  const { resolvedTheme } = useTheme();
  const boxes = useMemo(() => layoutGraph(graph), [graph]);

  const all = useMemo(
    () => [
      ...(graph.root ? [graph.root] : []),
      ...graph.stages,
      ...Object.values(graph.children).flat(),
      ...graph.triggers,
    ],
    [graph],
  );
  const nodes: FlowNode[] = all.flatMap((n) => {
    const box = boxes[n.id];
    if (!box) return [];
    return [
      {
        id: n.id,
        type: n.role,
        position: { x: box.x, y: box.y },
        width: box.width,
        height: box.height,
        data: { node: n },
        draggable: false,
        connectable: false,
        selectable: false,
        // React Flow drops pointer events on non-interactive nodes; ours open popovers.
        style: { pointerEvents: 'all' },
      },
    ];
  });

  const byId = new Map(all.map((n) => [n.id, n]));
  const edges: Edge[] = graph.edges.map((e) => {
    const target = byId.get(e.target);
    const source = byId.get(e.source);
    const live =
      e.kind === 'trigger'
        ? flashing.has(e.target) || target?.status === 'running'
        : target?.status === 'running' || (e.kind === 'flow' && target?.status === 'waiting_human');
    const settled =
      e.kind === 'trigger'
        ? Boolean(target?.state)
        : target?.status === 'done' || (e.kind === 'flow' && source?.status === 'done' && live);
    const state = live ? 'live' : settled ? 'done' : 'idle';
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      ...(e.kind === 'child' && { sourceHandle: 'kids' }),
      type: e.kind === 'child' ? 'smoothstep' : 'default',
      ...(e.kind === 'child' && { pathOptions: { borderRadius: 10, offset: 0 } }),
      animated: live,
      className: `edge-${state}`,
      ...(e.kind !== 'child' && {
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: COLOR[state] },
      }),
      selectable: false,
      focusable: false,
    };
  });

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
      fitView
      fitViewOptions={FIT}
      onInit={(flow) => {
        // Narrow screens can't show the whole pipeline legibly: focus on what is happening now.
        const narrow = window.innerWidth < 640;
        const focus = focusIds(graph);
        if (narrow && focus.length)
          setTimeout(
            () => flow.fitView({ ...FIT, maxZoom: 0.85, nodes: focus.map((id) => ({ id })) }),
            150,
          );
      }}
      minZoom={0.1}
      maxZoom={1.6}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      zoomOnDoubleClick={false}
      panOnScroll
      className="bg-transparent"
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}
