'use client';
import { Building2, ExternalLink, Gauge, Mail, Radar, Sparkles, UsersRound, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { columns, DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatCards } from '@/components/stat-cards';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ProspectRow } from '@/lib/data/prospects';
import { regionName } from '@/lib/format';
import { useUrlState } from '@/lib/use-url-state';
import { cn } from '@/lib/utils';

const col = columns<ProspectRow>();
type Source = ProspectRow['sources'][number];

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** The expandable research card: the researcher's signals (with source chips) and the score reasons. */
function ResearchCard({ row }: { row: ProspectRow }) {
  const t = useTranslations('prospects');
  const { research, scoreReasons } = row;
  if (!research && !scoreReasons.length)
    return <p className="p-4 text-sm text-muted-foreground">{t('noResearch')}</p>;
  return (
    <div className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles aria-hidden className="size-3.5 text-saffron" />
          {t('signalsTitle')}
        </h3>
        {research?.summary && <p className="text-sm text-muted-foreground">{research.summary}</p>}
        <ul className="flex flex-col gap-1.5">
          {(research?.signals ?? []).map((s) => (
            <li key={s.sourceUrl + s.text} className="flex flex-wrap items-center gap-1.5 text-sm">
              <Badge variant="outline">{s.kind}</Badge>
              <span>{s.text}</span>
              <a
                href={s.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {hostOf(s.sourceUrl)}
                <ExternalLink aria-hidden className="size-3" />
              </a>
            </li>
          ))}
          {!research?.signals.length && (
            <li className="text-sm text-muted-foreground">{t('noResearch')}</li>
          )}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Gauge aria-hidden className="size-3.5 text-muted-foreground" />
          {t('reasonsTitle')}
        </h3>
        <ul className="flex flex-col gap-1.5">
          {scoreReasons.map((r) => (
            <li key={r.text} className="text-sm">
              <span>{r.text}</span>
              {r.evidence && (
                <span className="block text-xs text-muted-foreground">{r.evidence}</span>
              )}
            </li>
          ))}
          {!scoreReasons.length && (
            <li className="text-sm text-muted-foreground">{t('noResearch')}</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Score({ value }: { value?: number }) {
  if (value === undefined) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="w-6 text-right font-medium tabular-nums">{value}</span>
      <span aria-hidden className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full', value >= 75 ? 'bg-saffron' : 'bg-chart-2')}
          style={{ width: `${value}%` }}
        />
      </span>
    </span>
  );
}

export function ProspectsView({ rows: all }: { rows: ProspectRow[] }) {
  const t = useTranslations('prospects');
  const sources = useTranslations('sources');
  const locale = useLocale();
  // `?source=` comes from the agent graph's "view output" on a prospecting source.
  const [source, setSource] = useUrlState('source');
  // "Strong fit" quick filter; the default campaign audience is strong + medium.
  const [strongOnly, setStrongOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = all.filter(
    (r) => (!source || r.sources.some((s) => s === source)) && (!strongOnly || r.fit === 'strong'),
  );
  const openRow = openId ? rows.find((r) => r.id === openId) : undefined;

  const cols = useMemo(
    () =>
      col.columns([
        col.accessor('name', {
          header: t('company'),
          cell: ({ row }) => (
            <span className="flex flex-col">
              <span className="font-medium">{row.original.name}</span>
              <span className="text-xs text-muted-foreground">{row.original.domain}</span>
            </span>
          ),
        }),
        col.accessor((r) => `${r.city ?? ''} ${regionName(locale, r.country)}`, {
          id: 'location',
          header: t('location'),
          cell: ({ row }) => (
            <span className="flex flex-col">
              <span>{row.original.city}</span>
              <span className="text-xs text-muted-foreground">
                {regionName(locale, row.original.country)}
              </span>
            </span>
          ),
        }),
        col.accessor('industry', { header: t('industry') }),
        col.accessor((r) => r.sources.join(' '), {
          id: 'sources',
          header: t('sources'),
          enableSorting: false,
          cell: ({ row }) => (
            <span className="flex flex-wrap gap-1">
              {row.original.sources.map((s) => (
                <Badge key={s} variant="outline">
                  {sources(s)}
                </Badge>
              ))}
            </span>
          ),
        }),
        col.accessor('score', {
          header: t('score'),
          sortUndefined: 'last',
          cell: ({ row }) => <Score value={row.original.score} />,
        }),
        col.accessor('fit', {
          header: t('fit'),
          cell: ({ row }) => (row.original.fit ? <StatusBadge status={row.original.fit} /> : null),
        }),
        col.accessor((r) => r.reasons.join(' '), {
          id: 'reasons',
          header: t('why'),
          enableSorting: false,
          cell: ({ row }) => (
            <span className="line-clamp-2 max-w-64 text-muted-foreground">
              {row.original.reasons.join(' · ')}
            </span>
          ),
        }),
        col.accessor((r) => r.contacts.length, {
          id: 'contacts',
          header: t('contacts'),
          cell: ({ row }) => (
            <span
              className="flex items-center gap-1.5 tabular-nums"
              title={row.original.contacts.map((c) => c.name ?? c.email).join(', ')}
            >
              <Mail aria-hidden className="size-3.5 text-muted-foreground" />
              {row.original.contacts.length}
            </span>
          ),
        }),
        col.accessor('status', {
          header: t('status'),
          cell: ({ row }) => <StatusBadge status={row.original.status} />,
        }),
      ]),
    [t, sources, locale],
  );

  const strong = rows.filter((r) => r.fit === 'strong').length;
  const people = rows.reduce((n, r) => n + r.contacts.length, 0);
  const scored = rows.filter((r) => r.score !== undefined);
  const avg = scored.length
    ? Math.round(scored.reduce((n, r) => n + (r.score ?? 0), 0) / scored.length)
    : '–';
  const sourceCount = new Set(rows.flatMap((r) => r.sources)).size;

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <StatCards
        label={t('title')}
        items={[
          { key: 'companies', label: t('companies'), value: rows.length, icon: Building2 },
          { key: 'strong', label: t('strong'), value: strong, tone: 'success', icon: Radar },
          { key: 'people', label: t('people'), value: people, icon: UsersRound },
          {
            key: 'score',
            label: t('avgScore'),
            value: avg,
            tone: 'accent',
            icon: Gauge,
            hint: t('sourceCount', { count: sourceCount }),
          },
        ]}
      />
      <DataTable
        label={t('title')}
        columns={cols}
        data={rows}
        selectable
        activeId={openId}
        onRowClick={(r) => setOpenId((id) => (id === r.id ? null : r.id))}
        toolbar={
          <>
            <Button
              variant={strongOnly ? 'default' : 'secondary'}
              size="sm"
              aria-pressed={strongOnly}
              onClick={() => setStrongOnly((v) => !v)}
            >
              <Radar aria-hidden />
              {t('strongOnly')}
            </Button>
            {source && (
              <Button variant="secondary" size="sm" onClick={() => setSource(null)}>
                {t('sourceFilter', {
                  source: sources.has(source as Source) ? sources(source as Source) : source,
                })}
                <X aria-hidden />
                <span className="sr-only">{t('clearFilter')}</span>
              </Button>
            )}
          </>
        }
        empty={
          <EmptyState
            icon={Radar}
            title={t('emptyTitle')}
            description={t('emptyHint')}
            className="m-3 border-0"
          />
        }
      />
      {openRow && <ResearchCard row={openRow} />}
    </>
  );
}
