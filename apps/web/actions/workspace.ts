'use server';
import { audit, WorkspaceSettings } from '@sutra/db';
import {
  countryFromSite,
  timezone,
  website,
  workspaceName,
  workspaceSettings,
} from '@sutra/domain';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AppError, action, userAction } from '@/lib/action';
import { auth } from '@/lib/auth';
import { startProfiler } from '@/lib/profiler';

/** Onboarding's one input: creates the workspace from the website, then starts the profiler. */
export const createWorkspace = userAction(
  z.object({ website, timezone: timezone.default('UTC').catch('UTC') }),
  async ({ user, headers }, { website: site, timezone: tz }) => {
    const host = new URL(site).hostname.replace(/^www\./, '');
    const org = await auth.api.createOrganization({
      headers,
      body: {
        name: workspaceName(site),
        slug: `${host.replace(/\./g, '-')}-${crypto.randomUUID().slice(0, 6)}`,
        metadata: { website: site },
      },
    });
    await WorkspaceSettings.create(org.id, {
      website: site,
      senderName: user.name || user.email.split('@')[0] || user.email,
      homeCountry: countryFromSite(site),
      timezone: tz,
      businessHours: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
      warmup: {},
    });
    const actor = { kind: 'user', id: user.id } as const;
    await audit(org.id, actor, 'workspace.create', { entity: 'workspaces', entityId: org.id });
    await startProfiler(org.id);
    redirect('/business');
  },
);

/** Per-country, stricter-only compliance overrides. Owners and admins only. */
export const updateComplianceOverrides = action(
  workspaceSettings.pick({ complianceOverrides: true }),
  async ({ workspaceId, user }, patch) => {
    const settings = await WorkspaceSettings.findOne(workspaceId, {});
    if (!settings) throw new AppError('NOT_FOUND', 'Workspace settings not found');
    const updated = await WorkspaceSettings.update(workspaceId, settings._id, patch);
    await audit(workspaceId, { kind: 'user', id: user.id }, 'settings.compliance.update', {
      entity: 'workspace_settings',
      entityId: settings._id,
      data: patch,
    });
    return updated?.complianceOverrides ?? {};
  },
  { role: 'admin' },
);
