import {
  audit,
  Campaigns,
  type CheckFor,
  Companies,
  Contacts,
  checkFor as dbCheckFor,
  Enrollments,
  Messages,
  WorkspaceSettings,
} from '@sutra/db';
import type {
  Actor,
  Campaign,
  CampaignVariant,
  Contact,
  Enrollment,
  Id,
  WorkspaceSettings as Settings,
  StopReason,
} from '@sutra/domain';
import { enrollmentTransitions, fillMergeFields } from '@sutra/domain';
import { personalizeForContact } from '../copywriter/personalize.ts';
import { defineJob, type JobPayload, enqueue as seamEnqueue } from '../jobs.ts';
import { nextAction, pickVariant } from './engine.ts';
import { scheduleStep, windowFor } from './schedule.ts';

const CAMPAIGN: Actor = { kind: 'system', id: 'campaign' };

export const CAMPAIGN_STEP_JOB = 'campaign.step';
export const DELIVER_JOB = 'deliver';

/** Injectable collaborators so `runStep` is fully testable without a clock, randomness or network. */
export interface RunStepDeps {
  now?: Date;
  random?: () => number;
  checkFor?: CheckFor;
  enqueue?: typeof seamEnqueue;
}

type StepPayload = { workspaceId: Id; enrollmentId: Id };

/** Moves an enrollment to a terminal state with its stop reason, clearing any schedule. */
async function stop(workspaceId: Id, enr: Enrollment, reason: StopReason) {
  if (enr.status === 'stopped' || enr.status === 'completed') return;
  const to = reason === 'campaign_done' ? 'completed' : 'stopped';
  await Enrollments.transition(workspaceId, enr._id, enr.status, to, enrollmentTransitions, {
    stopReason: reason,
    nextRunAt: undefined,
  });
  await audit(workspaceId, CAMPAIGN, 'campaign.stop', {
    entity: 'enrollment',
    entityId: enr._id,
    data: { reason },
  });
}

/**
 * Advances the enrollment to the next step (or completes it), scheduling the next run inside the
 * contact's send window. `enqueue`s the next `campaign.step`; the inline driver runs it at once but
 * it is a no-op `wait` until the scheduled time, and the `maintenance` sweep is the restart-safe
 * backstop.
 */
async function advance(
  workspaceId: Id,
  enr: Enrollment,
  campaign: Campaign,
  contact: Contact,
  settings: Settings | null,
  from: Date,
  enqueue: typeof seamEnqueue,
) {
  const nextIndex = enr.stepIndex + 1;
  const nextStep = campaign.steps[nextIndex];
  if (!nextStep) {
    await stop(workspaceId, enr, 'campaign_done');
    return;
  }
  const company = await Companies.get(workspaceId, contact.companyId);
  const window = windowFor(company?.country ?? 'US', settings?.complianceOverrides);
  const nextRunAt = scheduleStep(from, nextStep.delayDays, window, contact.timezone);
  await Enrollments.update(workspaceId, enr._id, { stepIndex: nextIndex, nextRunAt });
  await enqueue(CAMPAIGN_STEP_JOB, { workspaceId, enrollmentId: enr._id }, { runAt: nextRunAt });
}

/** The locale rendering of a variant for a contact: its translation, else the English template. */
const templateFor = (variant: CampaignVariant, contact: Contact) => {
  const translated = contact.locale !== 'en' ? variant.translations?.[contact.locale] : undefined;
  return translated ?? { subject: variant.subject, body: variant.body };
};

/**
 * The `campaign.step` job: one deterministic tick of the engine for one enrollment.
 *
 * 1. Loads the enrollment, campaign and thread → {@link nextAction}.
 * 2. `stop` on reply / bounce / finished sequence; `wait` when it's scheduled for later.
 * 3. `send`: assign a variant (uniform random until the bandit, PR 15), fill merge fields and the
 *    grounded personalisation line (PR 12), run `compliance.checkFor()`; a temporary block reschedules,
 *    a permanent one stops the enrollment, otherwise a queued message is created and `deliver` enqueued
 *    (PR 11). The send itself still needs the approved-variant permit, obtained inside `deliver`.
 * 4. Schedule the next step inside the contact's send window.
 *
 * A paused campaign or enrollment is a no-op (resume re-enqueues). Idempotent: a duplicate tick for
 * a step whose message already exists re-enqueues delivery instead of sending twice.
 */
export async function runStep(payload: JobPayload, deps: RunStepDeps = {}): Promise<void> {
  const { workspaceId, enrollmentId } = payload as StepPayload;
  const now = deps.now ?? new Date();
  const random = deps.random ?? Math.random;
  const check = deps.checkFor ?? dbCheckFor;
  const enqueue = deps.enqueue ?? seamEnqueue;

  const enr = await Enrollments.get(workspaceId, enrollmentId);
  if (!enr || enr.status === 'paused') return;
  const campaign = await Campaigns.get(workspaceId, enr.campaignId);
  if (!campaign || campaign.status === 'paused') return;
  if (campaign.status !== 'running' && campaign.status !== 'approved') return;

  const thread = await Messages.find(
    workspaceId,
    { contactId: enr.contactId },
    { sort: { createdAt: 1 } },
  );
  const action = nextAction(enr, campaign, thread, now);
  if (action.type === 'wait') return;
  if (action.type === 'stop') {
    await stop(workspaceId, enr, action.reason);
    return;
  }

  const contact = await Contacts.get(workspaceId, enr.contactId);
  const settings = await WorkspaceSettings.findOne(workspaceId, {});
  if (!contact) {
    await stop(workspaceId, enr, 'manual');
    return;
  }
  if (action.type === 'skip') {
    await advance(workspaceId, enr, campaign, contact, settings, now, enqueue);
    return;
  }

  const step = campaign.steps[action.stepIndex];
  const assignedId = enr.assignedVariants[String(action.stepIndex)];
  const variant =
    (assignedId && step?.variants.find((v) => v.id === assignedId)) ||
    (step && pickVariant(step, random));
  if (!step || !variant) {
    await advance(workspaceId, enr, campaign, contact, settings, now, enqueue);
    return;
  }

  // Idempotency: a retried tick for a step already materialised re-enqueues delivery, never a 2nd send.
  const idempotencyKey = `${enr._id}:${action.stepIndex}`;
  const existing = await Messages.findOne(workspaceId, { idempotencyKey });
  if (existing) {
    if (existing.status === 'queued')
      await enqueue(DELIVER_JOB, { workspaceId, messageId: existing._id });
    await advance(workspaceId, enr, campaign, contact, settings, now, enqueue);
    return;
  }

  // Compliance pre-check: reschedule on a temporary block, stop on a permanent one.
  const decision = await check(workspaceId, contact._id, { at: now });
  if (!decision.allow) {
    const codes = decision.reasons.map((r) => r.code);
    if (decision.retryAt) {
      await Enrollments.update(workspaceId, enr._id, { nextRunAt: decision.retryAt });
      await enqueue(
        CAMPAIGN_STEP_JOB,
        { workspaceId, enrollmentId: enr._id },
        { runAt: decision.retryAt },
      );
      return;
    }
    await stop(workspaceId, enr, codes.includes('suppressed') ? 'opted_out' : 'manual');
    return;
  }

  const company = await Companies.get(workspaceId, contact.companyId);
  const personalization = company
    ? await personalizeForContact({
        workspaceId,
        contact,
        company,
        campaignId: campaign._id,
        stepIndex: action.stepIndex,
      })
    : undefined;
  const template = templateFor(variant, contact);
  const values = {
    firstName: contact.firstName ?? contact.name?.split(' ')[0] ?? 'there',
    company: company?.name ?? 'your company',
    senderName: settings?.senderName ?? '',
    personalization: personalization?.line ?? '',
  };

  await Enrollments.update(workspaceId, enr._id, {
    assignedVariants: { ...enr.assignedVariants, [String(action.stepIndex)]: variant.id },
  });
  const message = await Messages.create(workspaceId, {
    contactId: contact._id,
    campaignId: campaign._id,
    enrollmentId: enr._id,
    stepIndex: action.stepIndex,
    direction: 'outbound',
    variantId: variant.id,
    status: 'queued',
    to: contact.email,
    subject: fillMergeFields(template.subject, values),
    body: fillMergeFields(template.body, values),
    idempotencyKey,
    scheduledAt: now,
  });
  await audit(workspaceId, CAMPAIGN, 'campaign.queued', {
    entity: 'message',
    entityId: message._id,
    data: { campaignId: campaign._id, stepIndex: action.stepIndex, variantId: variant.id },
  });
  await enqueue(DELIVER_JOB, { workspaceId, messageId: message._id });
  await advance(workspaceId, enr, campaign, contact, settings, now, enqueue);
}

defineJob(CAMPAIGN_STEP_JOB, (payload) => runStep(payload));

/**
 * Re-enqueues every active enrollment whose next step is due (`nextRunAt <= now`). Run by the
 * `maintenance` cron and after a resume, it makes the engine restart-safe: no step is ever lost
 * because its schedule lives in the database, not in a timer. Returns how many were swept.
 */
export async function sweepDueEnrollments(
  workspaceId: Id,
  now = new Date(),
  enqueue: typeof seamEnqueue = seamEnqueue,
): Promise<number> {
  const due = await Enrollments.find(workspaceId, {
    status: 'active',
    nextRunAt: { $lte: now },
  });
  for (const enr of due) await enqueue(CAMPAIGN_STEP_JOB, { workspaceId, enrollmentId: enr._id });
  return due.length;
}
