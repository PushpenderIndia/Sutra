'use client';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Clock, Hourglass, Inbox, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useEffect, useMemo } from 'react';
import { columns, DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { LiveDot } from '@/components/live-dot';
import { PageHeader } from '@/components/page-header';
import { StatCards, type StatItem } from '@/components/stat-cards';
import { StatusBadge } from '@/components/status-badge';
import { Thread } from '@/components/thread';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import type { LeadRow, ThreadMessage } from '@/lib/data/leads';
import { HOT_RANK, LEAD_BUCKETS, type LeadBucket } from '@/lib/leads';
import { useSelection } from '@/lib/selection';
import type { Tone } from '@/lib/tones';
import { useLive } from '@/lib/use-live';
import { useUrlState } from '@/lib/use-url-state';

const col = columns<LeadRow>();

const CARD: Record<LeadBucket, Pick<StatItem, 'icon' | 'tone'> & { tone: Tone }> = {
  interested: { icon: ThumbsUp, tone: 'success' },
  not_interested: { icon: ThumbsDown, tone: 'danger' },
  meeting_booked: { icon: CalendarCheck, tone: 'accent' },
  awaiting: { icon: Hourglass, tone: 'info' },
  not_now: { icon: Clock, tone: 'warning' },
};

/** "Hot" first (interested, meetings), then most recently updated. */
const hot = (a: LeadRow, b: LeadRow) =>
  (a.bucket ? HOT_RANK[a.bucket] : 9) - (b.bucket ? HOT_RANK[b.bucket] : 9) ||
  b.updatedAt.localeCompare(a.updatedAt);

export function LeadsView({ initial }: { initial: LeadRow[] }) {
  const t = useTranslations('leads');
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const rows = useLive('/api/leads', initial);
  const [status, setStatus] = useUrlState('status');
  const [open, setOpen] = useUrlState('lead');
  const select = useSelection((s) => s.select);

  const sorted = useMemo(() => [...rows].sort(hot), [rows]);
  const filtered = useMemo(
    () => (status ? sorted.filter((r) => r.bucket === status) : sorted),
    [sorted, status],
  );
  const lead = open ? rows.find((r) => r.id === open) : undefined;

  // The open lead is "this one" for the chat.
  useEffect(() => {
    if (open) select([open]);
  }, [open, select]);

  const cols = useMemo(
    () =>
      col.columns([
        col.accessor('name', {
          header: t('contact'),
          cell: ({ row }) => (
            <span className="flex flex-col">
              <span className="font-medium">{row.original.name}</span>
              <span className="text-xs text-muted-foreground">{row.original.title}</span>
            </span>
          ),
        }),
        col.accessor('company', { header: t('company') }),
        col.accessor('status', {
          header: t('status'),
          cell: ({ row }) => <StatusBadge status={row.original.status} />,
        }),
        col.accessor('intent', {
          header: t('intent'),
          sortUndefined: 'last',
          cell: ({ row }) =>
            row.original.intent ? <StatusBadge status={row.original.intent} /> : null,
        }),
        col.accessor('summary', {
          header: t('lastReply'),
          enableSorting: false,
          cell: ({ row }) => (
            <span className="line-clamp-1 max-w-40 text-muted-foreground">
              {row.original.summary ?? '–'}
            </span>
          ),
        }),
        col.accessor((r) => (r.variant ? `${r.step}${r.variant}` : ''), {
          id: 'variant',
          header: t('variant'),
          cell: ({ row }) =>
            row.original.step ? (
              <span className="tabular-nums text-muted-foreground">
                {t('stepVariant', { step: row.original.step, variant: row.original.variant ?? '' })}
              </span>
            ) : null,
        }),
        col.accessor('updatedAt', {
          header: t('updated'),
          cell: ({ row }) => (
            <time
              dateTime={row.original.updatedAt}
              className="whitespace-nowrap text-muted-foreground tabular-nums"
            >
              {format.relativeTime(new Date(row.original.updatedAt), now)}
            </time>
          ),
        }),
      ]),
    [t, format, now],
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <LiveDot live tone="success" />
            {t('live')}
          </span>
        }
      />
      <StatCards
        label={t('filters')}
        active={status}
        onSelect={setStatus}
        items={LEAD_BUCKETS.map((b) => ({
          key: b,
          label: t(`buckets.${b}`),
          value: rows.filter((r) => r.bucket === b).length,
          ...CARD[b],
        }))}
      />
      <DataTable
        label={t('title')}
        columns={cols}
        data={filtered}
        selectable
        activeId={open}
        onRowClick={(r) => setOpen(r.id)}
        empty={
          <EmptyState
            icon={Inbox}
            title={t('emptyTitle')}
            description={t('emptyHint')}
            className="m-3 border-0"
          />
        }
      />
      <Sheet open={Boolean(lead)} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full gap-0 sm:max-w-lg">
          {lead && <LeadSheet lead={lead} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

function LeadSheet({ lead }: { lead: LeadRow }) {
  const t = useTranslations('leads');
  const format = useFormatter();
  const url = `/api/leads/thread?contactId=${lead.id}`;
  const { data } = useQuery({
    queryKey: [url],
    queryFn: async ({ signal }) => (await (await fetch(url, { signal })).json()) as ThreadMessage[],
  });
  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="text-base">{lead.name}</SheetTitle>
        <SheetDescription>
          {[lead.title, lead.company].filter(Boolean).join(' · ')} · {lead.email}
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <StatusBadge status={lead.status} />
          {lead.intent && <StatusBadge status={lead.intent} />}
        </div>
        {lead.meetingAt && (
          <p className="flex items-center gap-1.5 pt-2 text-saffron-ink">
            <CalendarCheck aria-hidden className="size-4" />
            {t('meeting', {
              at: format.dateTime(new Date(lead.meetingAt), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })}
          </p>
        )}
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {data ? (
          <Thread messages={data} />
        ) : (
          <div className="flex flex-col gap-3" aria-busy="true">
            <Skeleton className="ml-auto h-24 w-4/5" />
            <Skeleton className="h-16 w-3/5" />
          </div>
        )}
      </div>
    </>
  );
}
