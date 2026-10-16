import { Loader } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { loadBusiness } from '@/lib/data/business';
import { requireWorkspace } from '@/lib/workspace';
import { BusinessView } from './business-view';

export const metadata: Metadata = { title: 'Business' };

export default async function BusinessPage() {
  const { workspaceId } = await requireWorkspace();
  const [{ profile, icp }, t] = await Promise.all([
    loadBusiness(workspaceId),
    getTranslations('business'),
  ]);
  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      {profile ? (
        <BusinessView profile={profile} icp={icp} />
      ) : (
        <EmptyState icon={Loader} title={t('emptyTitle')} description={t('emptyHint')} />
      )}
    </div>
  );
}
