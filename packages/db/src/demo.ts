import type { Id } from '@sutra/domain';
import { WorkspaceSettings } from './collections.ts';

/**
 * Whether a workspace is in demo mode. The seams (`@sutra/mail`, the agent `deps.ts` files) read
 * this instead of a build-time env flag, so the top-bar toggle can switch a workspace between demo
 * and live at runtime. Absent settings default to demo — no workspace calls a paid API or sends a
 * real email until an admin opts in.
 */
export async function isDemoMode(workspaceId: Id): Promise<boolean> {
  const settings = await WorkspaceSettings.findOne(workspaceId, {});
  return settings?.demoMode ?? true;
}
