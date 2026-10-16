// @vitest-environment happy-dom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSelection } from '@/lib/selection';
import { renderUi } from '@/test/render';
import { columns, DataTable } from './data-table';

type Row = { id: string; name: string; score: number };
const rows: Row[] = [
  { id: 'a1', name: 'Kopi Nusantara', score: 92 },
  { id: 'b2', name: 'Roti Pagi', score: 70 },
  { id: 'c3', name: 'Pho Saigon House', score: 81 },
];
const col = columns<Row>();
const cols = col.columns([
  col.accessor('name', { header: 'Company' }),
  col.accessor('score', { header: 'Score' }),
]);

const names = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((r) => r.querySelector('td:nth-child(2)')?.textContent);

describe('<DataTable>', () => {
  beforeEach(() => useSelection.setState({ tab: 'prospects', selectedIds: [] }));
  afterEach(cleanup);

  it('mirrors row selection into the selection context', async () => {
    const user = userEvent.setup();
    renderUi(<DataTable label="Prospects" columns={cols} data={rows} selectable />);
    const [all, first, , third] = screen.getAllByRole('checkbox');

    await user.click(first as HTMLElement);
    expect(useSelection.getState().selectedIds).toEqual(['a1']);
    await user.click(third as HTMLElement);
    expect(useSelection.getState().selectedIds).toEqual(['a1', 'c3']);
    expect(screen.getByText('2 rows selected')).toBeTruthy();

    await user.click(first as HTMLElement);
    expect(useSelection.getState().selectedIds).toEqual(['c3']);
    await user.click(all as HTMLElement);
    expect(useSelection.getState().selectedIds.toSorted()).toEqual(['a1', 'b2', 'c3']);
  });

  it('switching tabs clears the selection', () => {
    useSelection.getState().select(['a1']);
    useSelection.getState().setTab('prospects');
    expect(useSelection.getState().selectedIds).toEqual(['a1']);
    useSelection.getState().setTab('leads');
    expect(useSelection.getState()).toMatchObject({ tab: 'leads', selectedIds: [] });
  });

  it('sorts by a column and filters with search', async () => {
    const user = userEvent.setup();
    renderUi(<DataTable label="Prospects" columns={cols} data={rows} selectable />);
    // Numbers sort highest first, then ascending.
    await user.click(screen.getByRole('button', { name: /Score/ }));
    expect(names()).toEqual(['Kopi Nusantara', 'Pho Saigon House', 'Roti Pagi']);
    await user.click(screen.getByRole('button', { name: /Score/ }));
    expect(names()).toEqual(['Roti Pagi', 'Pho Saigon House', 'Kopi Nusantara']);
    await user.type(screen.getByRole('searchbox'), 'roti');
    expect(names()).toEqual(['Roti Pagi']);
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('activates rows by click and Enter', async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    renderUi(
      <DataTable label="Leads" columns={cols} data={rows} onRowClick={(r) => opened.push(r.id)} />,
    );
    await user.click(screen.getByText('Roti Pagi'));
    screen.getAllByRole('row')[1]?.focus();
    await user.keyboard('{Enter}');
    expect(opened).toEqual(['b2', 'a1']);
  });
});
