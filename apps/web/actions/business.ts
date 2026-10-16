'use server';
import { CHECKPOINT_PROFILE, resumePipeline } from '@sutra/agents';
import { audit, BusinessProfiles, Icps } from '@sutra/db';
import { businessProfile, icp } from '@sutra/domain';
import { z } from 'zod';
import { AppError, action } from '@/lib/action';
import { mainPipeline } from '@/lib/pipeline';

const latest = { sort: { version: -1 }, limit: 1 } as const;

/** Saves an edit to the business profile as a new draft version (checkpoint 1). */
export const saveProfile = action(
  businessProfile.partial(),
  async ({ workspaceId, user }, patch) => {
    const [current] = await BusinessProfiles.find(workspaceId, {}, latest);
    if (!current) throw new AppError('NOT_FOUND', 'There is no profile to edit yet');
    const { _id, workspaceId: _ws, createdAt, updatedAt, version, status, ...fields } = current;
    const next = await BusinessProfiles.create(workspaceId, {
      ...fields,
      ...patch,
      status: 'draft',
      version: version + 1,
    });
    await audit(workspaceId, { kind: 'user', id: user.id }, 'profile.edit', {
      entity: 'business_profiles',
      entityId: next._id,
      data: { version: next.version, fields: Object.keys(patch) },
    });
    return { version: next.version };
  },
);

/** Saves an edit to the ICP as a new draft version. */
export const saveIcp = action(icp.partial(), async ({ workspaceId, user }, patch) => {
  const [current] = await Icps.find(workspaceId, {}, latest);
  if (!current) throw new AppError('NOT_FOUND', 'There is no ICP to edit yet');
  const { _id, workspaceId: _ws, createdAt, updatedAt, version, status, ...fields } = current;
  const next = await Icps.create(workspaceId, {
    ...fields,
    ...patch,
    status: 'draft',
    version: version + 1,
  });
  await audit(workspaceId, { kind: 'user', id: user.id }, 'icp.edit', {
    entity: 'icps',
    entityId: next._id,
    data: { version: next.version, fields: Object.keys(patch) },
  });
  return { version: next.version };
});

/**
 * Confirms the latest profile and ICP (owner/admin), then resumes the paused pipeline so
 * prospecting can begin. Nothing downstream runs until this happens.
 */
export const confirmProfile = action(
  z.object({}).default({}),
  async ({ workspaceId, user }) => {
    const [profile] = await BusinessProfiles.find(workspaceId, {}, latest);
    if (!profile) throw new AppError('NOT_FOUND', 'There is no profile to confirm');
    const [icpDoc] = await Icps.find(workspaceId, {}, latest);
    await BusinessProfiles.update(workspaceId, profile._id, { status: 'confirmed' });
    if (icpDoc) await Icps.update(workspaceId, icpDoc._id, { status: 'confirmed' });
    await audit(workspaceId, { kind: 'user', id: user.id }, 'profile.confirm', {
      entity: 'business_profiles',
      entityId: profile._id,
    });
    // Resume the run waiting at checkpoint 1, if any (seeded/demo workspaces have no live run).
    const pipeline = mainPipeline();
    if (pipeline) await resumePipeline(pipeline, workspaceId, CHECKPOINT_PROFILE).catch(() => {});
    return { status: 'confirmed' as const };
  },
  { role: 'admin' },
);
