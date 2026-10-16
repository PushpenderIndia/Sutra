'use client';
import { Eye, Megaphone, MousePointerClick, Reply, Send, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Checkpoint } from '@/components/checkpoint';
import { columns, DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatCards } from '@/components/stat-cards';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import type { CampaignView } from '@/lib/data/campaigns';
import { percent } from '@/lib/format';

type VariantRow = CampaignView['steps'][number]['variants'][number];
const col = columns<VariantRow>();
const sum = (vs: VariantRow[], k: keyof VariantRow['stats']) =>
  vs.reduce((n, v) => n + v.stats[k], 0);

export function CampaignsView({ campaigns }: { campaigns: CampaignView[] }) {
  const t = useTranslations('campaigns');
  const cols = useMemo(
    () =>
      col.columns([
        col.accessor('letter', {
          header: t('variant'),
          cell: ({ row }) => (
            <span className="flex size-6 items-center justify-center rounded-md bg-secondary font-semibold">
              {row.original.letter}
            </span>
          ),
        }),
        col.accessor('subject', {
          header: t('subject'),
          cell: ({ row }) => (
            <span className="flex max-w-md flex-col gap-0.5">
              <span className="font-medium">{row.original.subject}</span>
              <span className="text-xs text-muted-foreground">
                {row.original.origin === 'optimizer' && (
                  <Sparkles
                    aria-label={t('optimizer')}
                    className="mr-1 inline size-3 text-saffron-ink"
                  />
                )}
                {row.original.hypothesis}
              </span>
            </span>
          ),
        }),
        col.accessor('status', {
          header: t('status'),
          cell: ({ row }) => <StatusBadge status={row.original.status} />,
        }),
        col.accessor((v) => v.stats.sent, {
          id: 'sent',
          header: t('sent'),
          cell: (c) => <span className="tabular-nums">{c.getValue()}</span>,
        }),
        col.accessor((v) => v.stats.opens, {
          id: 'opens',
          header: t('opens'),
          cell: (c) => <span className="tabular-nums text-muted-foreground">≈{c.getValue()}</span>,
        }),
        col.accessor((v) => v.stats.clicks, {
          id: 'clicks',
          header: t('clicks'),
          cell: (c) => <span className="tabular-nums">{c.getValue()}</span>,
        }),
        col.accessor((v) => v.stats.replies, {
          id: 'replies',
          header: t('replies'),
          cell: (c) => <span className="tabular-nums">{c.getValue()}</span>,
        }),
        col.accessor((v) => (v.stats.sent ? v.stats.replies / v.stats.sent : -1), {
          id: 'rate',
          header: t('replyRate'),
          cell: ({ row }) => (
            <span className="font-medium tabular-nums">
              {percent(row.original.stats.replies, row.original.stats.sent)}
            </span>
          ),
        }),
      ]),
    [t],
  );

  if (!campaigns.length) {
    return (
      <>
        <PageHeader title={t('title')} description={t('description')} />
        <EmptyState icon={Megaphone} title={t('emptyTitle')} description={t('emptyHint')} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      {campaigns.map((c) => {
        const all = c.steps.flatMap((s) => s.variants);
        const pending = all.filter((v) => v.status === 'pending_approval').length;
        const sent = sum(all, 'sent');
        return (
          <section key={c.id} aria-labelledby={`c-${c.id}`} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={`c-${c.id}`} className="text-base font-semibold">
                {c.name}
              </h2>
              <StatusBadge status={c.status} />
              {c.persona && <Badge variant="outline">{c.persona}</Badge>}
            </div>
            <Checkpoint
              title={t('checkpoint')}
              summary={
                pending
                  ? t('pendingVariants', { count: pending })
                  : t('checkpointHint', { steps: c.steps.length, variants: all.length })
              }
              confirmed={!pending && !['draft', 'pending_approval'].includes(c.status)}
            />
            <StatCards
              label={c.name}
              items={[
                { key: 'sent', label: t('sent'), value: sent, icon: Send },
                {
                  key: 'opens',
                  label: t('opensApprox'),
                  value: `≈${sum(all, 'opens')}`,
                  icon: Eye,
                  tone: 'muted',
                  hint: t('opensHint'),
                },
                {
                  key: 'clicks',
                  label: t('clicks'),
                  value: sum(all, 'clicks'),
                  icon: MousePointerClick,
                  tone: 'info',
                  hint: percent(sum(all, 'clicks'), sent),
                },
                {
                  key: 'replies',
                  label: t('replies'),
                  value: sum(all, 'replies'),
                  icon: Reply,
                  tone: 'accent',
                  hint: t('rate', { rate: percent(sum(all, 'replies'), sent) }),
                },
              ]}
            />
            <ol className="flex flex-col gap-4">
              {c.steps.map((s) => (
                <li key={s.index} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <h3 className="font-medium">
                      {t('step', { n: s.index + 1 })}
                      {s.intent && (
                        <span className="text-muted-foreground"> · {t(`intents.${s.intent}`)}</span>
                      )}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {s.delayDays ? t('delay', { days: s.delayDays }) : t('immediately')}
                      {s.angle && ` · ${s.angle}`}
                    </span>
                  </div>
                  <DataTable
                    label={t('step', { n: s.index + 1 })}
                    columns={cols}
                    data={s.variants}
                    searchable={false}
                  />
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </>
  );
}
