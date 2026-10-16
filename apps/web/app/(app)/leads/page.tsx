import type { Metadata } from 'next';
import { loadLeads } from '@/lib/data/leads';
import { requireWorkspace } from '@/lib/workspace';
import { LeadsView } from './leads-view';

export const metadata: Metadata = { title: 'Leads' };

export default async function LeadsPage() {
  const { workspaceId } = await requireWorkspace();
  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <LeadsView initial={await loadLeads(workspaceId)} />
    </div>
  );
}
