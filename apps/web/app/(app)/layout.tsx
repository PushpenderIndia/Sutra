import { WorkspaceSettings } from '@sutra/db';
import { hasRole } from '@sutra/domain';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { Suspense } from 'react';
import { QueryProvider } from '@/components/providers';
import { AppShell } from '@/components/shell/app-shell';
import { Copilot } from '@/components/shell/copilot';
import { Header } from '@/components/shell/header';
import { HtmlLang } from '@/components/shell/preferences';
import { TabNav } from '@/components/shell/tab-nav';
import { auth } from '@/lib/auth';
import { loadLatestRun } from '@/lib/data/pipeline';
import { graphTopology } from '@/lib/pipeline';
import { requireWorkspace } from '@/lib/workspace';

/** Every `(app)` page needs a verified session and an active workspace, then gets the shell. */
async function Shell({ children }: { children: React.ReactNode }) {
  const { user, workspaceId, role } = await requireWorkspace();
  const [run, orgs, settings] = await Promise.all([
    loadLatestRun(workspaceId),
    auth.api.listOrganizations({ headers: await headers() }),
    WorkspaceSettings.findOne(workspaceId, {}),
  ]);
  const workspaces = orgs.map((o) => ({ id: o.id, name: o.name }));
  const workspace = workspaces.find((w) => w.id === workspaceId) ?? {
    id: workspaceId,
    name: 'Workspace',
  };
  return (
    // Dates render in the workspace's time zone, identically on server and client.
    <NextIntlClientProvider timeZone={settings?.timezone ?? 'UTC'} now={new Date()}>
      <QueryProvider>
        <HtmlLang />
        <AppShell
          header={
            <Header
              user={user}
              workspace={workspace}
              workspaces={workspaces}
              run={run}
              topology={graphTopology()}
              canRerun={hasRole(role, 'admin')}
            />
          }
          chat={<Copilot />}
        >
          <TabNav />
          {children}
        </AppShell>
      </QueryProvider>
    </NextIntlClientProvider>
  );
}

export default function AppLayout({ children }: LayoutProps<'/'>) {
  return (
    <Suspense fallback={<div className="h-dvh animate-pulse bg-background" />}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
