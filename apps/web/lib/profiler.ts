import 'server-only';
import type { Id } from '@sutra/domain';

/**
 * Kicks off business profiling for a new workspace. Placeholder: PR 07 replaces the body with
 * a profiler pipeline run (researching `website`, then checkpoint 1 on the Business tab).
 */
export async function startProfiler(workspaceId: Id, website: string): Promise<void> {
  console.info(`[profiler] queued for workspace ${workspaceId} (${website})`);
}
