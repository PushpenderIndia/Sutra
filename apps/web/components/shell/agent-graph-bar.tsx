'use client';
import { Check, ChevronRight, Hand, Loader, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { LiveDot } from '@/components/live-dot';
import { STATUS_TONE } from '@/components/status-badge';
import type { NodeView, RunView } from '@/lib/data/pipeline';
import { cn } from '@/lib/utils';

/** Stages shown before a workspace has its first run. */
const DEFAULT_STAGES = [
  'profiler',
  'checkpoint1',
  'prospector',
  'enricher',
  'copywriter',
  'checkpoint2',
  'sender',
];

const ICON = { done: Check, failed: X, running: Loader, waiting_human: Hand } as const;

/**
 * The top-bar slot for the live agent graph. This is the static placeholder: one pill per
 * top-level stage of the latest run. PR 17 replaces the internals (React Flow, sub-agents,
 * polling, popovers) behind the same `run` prop.
 */
export function AgentGraphBar({ run }: { run: RunView | null }) {
  const t = useTranslations('graph');
  const nodes: Pick<NodeView, 'nodeId' | 'status'>[] =
    run?.nodes ?? DEFAULT_STAGES.map((nodeId) => ({ nodeId, status: 'queued' as const }));
  const label = (id: string) => {
    const key = `agents.${id}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : id;
  };
  const current =
    nodes.find((n) => n.status === 'running' || n.status === 'waiting_human') ?? nodes.at(-1);
  const live = run?.status === 'running';

  return (
    <section aria-label={t('label')} className="flex min-w-0 items-center">
      {/* Mobile: one summary pill. */}
      <p className="flex min-w-0 items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs whitespace-nowrap md:hidden">
        <LiveDot live={live} tone={live ? 'accent' : run ? 'success' : 'muted'} />
        <span className="truncate">
          {live && current
            ? t('running', { agent: label(current.nodeId) })
            : run
              ? t('idle')
              : t('notStarted')}
        </span>
      </p>
      {/* Desktop: the stage pills. */}
      <ol className="hidden min-w-0 items-center gap-0.5 overflow-x-auto md:flex [scrollbar-width:none]">
        {nodes.map((n, i) => {
          const human = n.nodeId.startsWith('checkpoint');
          const Icon = human && n.status !== 'done' ? Hand : ICON[n.status as keyof typeof ICON];
          return (
            <Fragment key={n.nodeId}>
              {i > 0 && (
                <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/60" />
              )}
              <li
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                  n.status === 'running' &&
                    'motion-safe:animate-glow border-saffron/60 bg-saffron/10',
                  n.status === 'waiting_human' && 'border-saffron/60',
                  n.status === 'queued' && 'border-dashed text-muted-foreground',
                  n.status === 'done' && 'bg-card',
                )}
              >
                {Icon ? (
                  <Icon
                    aria-hidden
                    className={cn(
                      'size-3',
                      n.status === 'running' && 'motion-safe:animate-spin text-saffron-ink',
                      n.status === 'done' && 'text-emerald-600 dark:text-emerald-400',
                    )}
                  />
                ) : (
                  <LiveDot tone={STATUS_TONE[n.status]} />
                )}
                <span>{human ? t('you') : label(n.nodeId)}</span>
                <span className="sr-only">: {t(`status.${n.status}`)}</span>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}
