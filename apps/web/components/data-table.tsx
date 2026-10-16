'use client';
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  type RowSelectionState,
  rowSelectionFeature,
  rowSortingFeature,
  type SortingState,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  type TableOptions,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown, Search, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { Checkbox } from '@/components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSelection } from '@/lib/selection';
import { cn } from '@/lib/utils';

/** The one feature set every table in the app uses: sort, search, select. */
export const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
  },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowSelectionFeature,
});
export type Features = typeof features;

/** Typed column builder for `<DataTable>`: `const col = columns<LeadRow>()`. */
export const columns = <T extends object>() => createColumnHelper<Features, T>();

type Props<T extends { id: string }> = {
  columns: TableOptions<Features, T>['columns'];
  data: T[];
  /** Accessible name of the table. */
  label: string;
  /** Show row checkboxes; the selection is mirrored into `useSelection()` for the chat. */
  selectable?: boolean;
  /** Called when a row is activated (click, Enter). */
  onRowClick?: (row: T) => void;
  /** The row shown as open (e.g. in a side sheet). */
  activeId?: string | null;
  /** Show the search box. */
  searchable?: boolean;
  toolbar?: React.ReactNode;
  empty?: React.ReactNode;
  className?: string;
};

/**
 * The app's table: TanStack Table with sorting, global search and row selection, rendered with
 * shadcn's table. Selection is keyed by row `id` and synced to the selection context.
 */
export function DataTable<T extends { id: string }>({
  columns: cols,
  data,
  label,
  selectable = false,
  onRowClick,
  activeId,
  searchable = true,
  toolbar,
  empty,
  className,
}: Props<T>) {
  const t = useTranslations('table');
  const select = useSelection((s) => s.select);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const withSelect = useMemo(() => {
    if (!selectable) return cols;
    const helper = createColumnHelper<Features, T>();
    return [
      helper.display({
        id: 'select',
        header: ({ table }) => (
          <Checkbox
            aria-label={t('selectAll')}
            checked={
              table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && 'indeterminate')
            }
            onCheckedChange={(v) => table.toggleAllRowsSelected(v === true)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={t('selectRow')}
            checked={row.getIsSelected()}
            onClick={(e) => {
              e.stopPropagation();
              row.getToggleSelectedHandler()(e);
            }}
          />
        ),
        enableSorting: false,
      }),
      ...cols,
    ] as typeof cols;
  }, [cols, selectable, t]);

  const table = useTable({
    features,
    columns: withSelect,
    data,
    getRowId: (row) => row.id,
    state: { sorting, globalFilter, rowSelection },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    globalFilterFn: 'includesString',
    enableRowSelection: selectable,
  });

  useEffect(() => {
    if (selectable) select(Object.keys(rowSelection).filter((id) => rowSelection[id]));
  }, [rowSelection, select, selectable]);

  const rows = table.getRowModel().rows;
  const selected = Object.values(rowSelection).filter(Boolean).length;

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchable && (
            <InputGroup className="w-full sm:max-w-xs">
              <InputGroupAddon>
                <Search aria-hidden />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                aria-label={t('search')}
                placeholder={t('search')}
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
              />
            </InputGroup>
          )}
          {selectable && selected > 0 && (
            <span className="text-muted-foreground tabular-nums" aria-live="polite">
              {t('selected', { count: selected })}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">{toolbar}</div>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table aria-label={label}>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const sort = header.column.getIsSorted();
                  const Icon =
                    sort === 'asc' ? ArrowUp : sort === 'desc' ? ArrowDown : ChevronsUpDown;
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        'h-9 text-xs font-medium text-muted-foreground',
                        header.id === 'select' && 'w-10',
                      )}
                      aria-sort={
                        sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : undefined
                      }
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="-mx-1 inline-flex items-center gap-1 rounded px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          <table.FlexRender header={header} />
                          <Icon aria-hidden className={cn('size-3', !sort && 'opacity-40')} />
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? 'selected' : undefined}
                aria-current={activeId === row.id ? 'true' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick && (() => onRowClick(row.original))}
                onKeyDown={
                  onRowClick &&
                  ((e) => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(row.original);
                  })
                }
                className={cn(
                  onRowClick && 'cursor-pointer outline-none focus-visible:bg-muted',
                  activeId === row.id && 'bg-saffron/8',
                )}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2.5">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!rows.length &&
          (globalFilter ? (
            <EmptyState
              icon={SearchX}
              title={t('noMatches')}
              description={t('noMatchesHint')}
              className="m-3 border-0"
            />
          ) : (
            (empty ?? <p className="p-8 text-center text-muted-foreground">{t('empty')}</p>)
          ))}
      </div>
    </div>
  );
}
