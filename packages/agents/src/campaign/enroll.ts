import { audit, Campaigns, Companies, Contacts, Enrollments, WorkspaceSettings } from '@sutra/db';
import type { Actor, Campaign, ContactStatus, Id } from '@sutra/domain';
import { enqueue as seamEnqueue } from '../jobs.ts';
import { CAMPAIGN_STEP_JOB } from './run-step.ts';
import { scheduleStep, windowFor } from './schedule.ts';

const CAMPAIGN: Actor = { kind: 'system', id: 'campaign' };

export interface EnrollDeps {
  now?: Date;
  enqueue?: typeof seamEnqueue;
}

/** Contacts of this persona who can be contacted (not suppressed or excluded). */
const UNCONTACTABLE: ContactStatus[] = ['suppressed', 'excluded'];
const audienceFilter = (campaign: Pick<Campaign, 'persona'>) => ({
  ...(campaign.persona ? { personaMatch: campaign.persona } : {}),
  status: { $nin: UNCONTACTABLE },
});

/**
 * Enrols an approved campaign's audience and schedules each contact's first step inside its send
 * window. Idempotent: contacts already enrolled (the unique `campaignId + contactId` index) are
 * skipped, so re-running after a resume or a duplicate approval never double-enrols. Returns how
 * many new contacts were enrolled.
 */
export async function enrollCampaign(
  workspaceId: Id,
  campaign: Campaign,
  { now = new Date(), enqueue = seamEnqueue }: EnrollDeps = {},
): Promise<number> {
  const firstStep = campaign.steps[0];
  if (!firstStep) return 0;

  const [contacts, existing, settings] = await Promise.all([
    Contacts.find(workspaceId, audienceFilter(campaign)),
    Enrollments.find(workspaceId, { campaignId: campaign._id }, { projection: { contactId: 1 } }),
    WorkspaceSettings.findOne(workspaceId, {}),
  ]);
  const enrolled = new Set(existing.map((e) => e.contactId));
  const fresh = contacts.filter((c) => !enrolled.has(c._id));

  let count = 0;
  for (const contact of fresh) {
    const company = await Companies.get(workspaceId, contact.companyId);
    const window = windowFor(company?.country ?? 'US', settings?.complianceOverrides);
    const nextRunAt = scheduleStep(now, firstStep.delayDays, window, contact.timezone);
    const enrollment = await Enrollments.create(workspaceId, {
      contactId: contact._id,
      campaignId: campaign._id,
      stepIndex: 0,
      status: 'active',
      assignedVariants: {},
      nextRunAt,
    });
    await enqueue(
      CAMPAIGN_STEP_JOB,
      { workspaceId, enrollmentId: enrollment._id },
      { runAt: nextRunAt },
    );
    count++;
  }
  if (count)
    await audit(workspaceId, CAMPAIGN, 'campaign.enroll', {
      entity: 'campaigns',
      entityId: campaign._id,
      data: { enrolled: count },
    });
  return count;
}

/** Enrols every approved/running campaign's audience (the `sender` pipeline node after approval). */
export async function enrollApprovedCampaigns(
  workspaceId: Id,
  deps: EnrollDeps = {},
): Promise<number> {
  const campaigns = await Campaigns.find(workspaceId, { status: { $in: ['approved', 'running'] } });
  let total = 0;
  for (const campaign of campaigns) total += await enrollCampaign(workspaceId, campaign, deps);
  return total;
}
