import 'server-only';
import { type Id, topRole } from '@sutra/domain';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { auth, getSession } from '@/lib/auth';

/**
 * The signed-in user's active workspace and role for this render, or a redirect to
 * `/sign-in` / `/onboarding`. Pages use it to scope their reads, like `action()` does for writes.
 */
export const requireWorkspace = cache(async () => {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  const member = await auth.api.getActiveMember({ headers: await headers() }).catch(() => null);
  const role = member && topRole(member.role);
  if (!member || !role) redirect('/onboarding');
  return { user: session.user, workspaceId: member.organizationId as Id, role };
});
