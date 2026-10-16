'use client';
import { organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { useRouter } from 'next/navigation';

export const authClient = createAuthClient({ plugins: [organizationClient()] });

/** The active workspace, the user's workspaces, and a switcher that re-renders the server tree. */
export function useWorkspace() {
  const router = useRouter();
  const { data: workspace } = authClient.useActiveOrganization();
  const { data: workspaces } = authClient.useListOrganizations();
  async function switchTo(organizationId: string) {
    await authClient.organization.setActive({ organizationId });
    router.refresh();
  }
  return { workspace, workspaces: workspaces ?? [], switchTo };
}
