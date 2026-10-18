import type { Id } from '@sutra/domain';
import { type CollectionName, repositories } from './collections.ts';

/**
 * Deletes every Sutra-owned document for a workspace, across all collections. Better Auth manages
 * its own rows (organization, member, invitation, session) and deletes them with the organization;
 * this covers everything keyed by `workspaceId`. Returns the number of documents removed per
 * collection. There is no undo — the caller must have already confirmed the teardown.
 */
export async function purgeWorkspace(workspaceId: Id): Promise<Record<CollectionName, number>> {
  const counts = await Promise.all(
    repositories.map(async (repo) => [repo.name, await repo.purge(workspaceId)] as const),
  );
  return Object.fromEntries(counts) as Record<CollectionName, number>;
}
