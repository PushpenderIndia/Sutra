import type { Metadata } from 'next';
import { loadCampaigns } from '@/lib/data/campaigns';
import { requireWorkspace } from '@/lib/workspace';
import { CampaignsView } from './campaigns-view';

export const metadata: Metadata = { title: 'Campaigns' };

export default async function CampaignsPage() {
  const { workspaceId } = await requireWorkspace();
  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <CampaignsView campaigns={await loadCampaigns(workspaceId)} />
    </div>
  );
}
