'use client';
import { ArrowUpRight, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { outputHref } from '@/lib/graph/links';
import { durationMs, type GraphNode, recentToolCalls } from '@/lib/graph/model';
import { useNodeLabel } from '@/lib/graph/use-labels';
import { Meter, useGraph, useLiveLine } from './parts';

/** Re-runnable: top-level agent stages (not checkpoints, sub-agents or event-driven nodes). */
const rerunnable = (n: GraphNode) => n.role === 'stage';

/** The node popover: summary, duration, tokens and cost, last tool calls, links and re-run. */
export function NodeDetails({ node }: { node: GraphNode }) {
  const t = useTranslations('graph');
  const format = useFormatter();
  const label = useNodeLabel();
  const line = useLiveLine();
  const { nodes, children, now, onRerun, traceLink, setOpenId } = useGraph();
  const s = node.state;
  const ms = durationMs(s, now);
  const calls = recentToolCalls(nodes, node.id);
  const href = outputHref(node);
  const progress = s?.progress;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate font-medium">{label(node)}</p>
          <p className="text-xs text-muted-foreground">{line(node, children[node.id])}</p>
        </div>
        <StatusBadge status={node.status} className="shrink-0" />
      </div>
      {progress?.total ? (
        <div className="flex items-center gap-2 text-xs tabular-nums">
          <Meter done={progress.done} total={progress.total} />
          <span className="shrink-0">{t('progress', progress)}</span>
        </div>
      ) : null}
      <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-2 text-xs">
        {(
          [
            [t('duration'), ms === undefined ? '–' : formatDuration(ms)],
            [t('tokens'), format.number(s?.tokens ?? 0, { notation: 'compact' })],
            [
              t('cost'),
              format.number(s?.costUsd ?? 0, {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 4,
              }),
            ],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <section aria-label={t('toolCalls')} className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-muted-foreground">{t('toolCalls')}</h3>
        {calls.length ? (
          <ol className="flex flex-col gap-1">
            {calls.map((c) => (
              <li key={`${c.agent}:${c.at}:${c.name}`} className="flex items-center gap-2 text-xs">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {c.name}
                </code>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {format.relativeTime(Date.parse(c.at), now)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground">{t('noToolCalls')}</p>
        )}
      </section>
      {(href || traceLink || (onRerun && rerunnable(node))) && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          {traceLink && (
            <Button size="sm" variant="ghost" asChild>
              <a href={traceLink} target="_blank" rel="noreferrer">
                {t('viewTrace')}
                <ArrowUpRight aria-hidden />
              </a>
            </Button>
          )}
          {onRerun && rerunnable(node) && (
            <Button
              size="sm"
              variant="ghost"
              title={t('rerunHint')}
              disabled={node.status === 'running' || node.status === 'queued'}
              onClick={() => {
                setOpenId(null);
                onRerun(node.id);
              }}
            >
              <RotateCcw aria-hidden />
              {t('rerun')}
            </Button>
          )}
          {href && (
            <Button size="sm" variant="outline" asChild>
              <Link href={href} onClick={() => setOpenId(null)}>
                {node.role === 'human' ? t('openCheckpoint') : t('viewOutput')}
                <ArrowUpRight aria-hidden />
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** `3.4s`, `1m 12s`. */
function formatDuration(ms: number) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
