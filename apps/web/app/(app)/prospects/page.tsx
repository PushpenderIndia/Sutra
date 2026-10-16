import type { Metadata } from 'next';
import { loadProspects } from '@/lib/data/prospects';
import { requireWorkspace } from '@/lib/workspace';
import { ProspectsView } from './prospects-view';

export const metadata: Metadata = { title: 'Prospects' };

export default async function ProspectsPage() {
  const { workspaceId } = await requireWorkspace();
  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <ProspectsView rows={await loadProspects(workspaceId)} />
    </div>
  );
}
