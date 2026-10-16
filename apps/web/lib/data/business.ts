import 'server-only';
import { BusinessProfiles, Icps } from '@sutra/db';
import type { Id } from '@sutra/domain';

const latest = { sort: { version: -1 }, limit: 1 } as const;

/** The latest business profile and ICP versions (either may not exist yet). */
export async function loadBusiness(workspaceId: Id) {
  const [[profile], [icp]] = await Promise.all([
    BusinessProfiles.find(workspaceId, {}, latest),
    Icps.find(workspaceId, {}, latest),
  ]);
  return { profile, icp };
}
