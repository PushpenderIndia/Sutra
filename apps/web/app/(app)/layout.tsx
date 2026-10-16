import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getSession } from '@/lib/auth';

/** Every `(app)` page needs a verified session and an active workspace. */
async function RequireWorkspace({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  if (!session.session.activeOrganizationId) redirect('/onboarding');
  return children;
}

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <Suspense>
      <RequireWorkspace>{children}</RequireWorkspace>
    </Suspense>
  );
}
