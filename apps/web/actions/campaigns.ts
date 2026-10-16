'use server';
import {
  CAMPAIGN_STEP_JOB,
  CHECKPOINT_CAMPAIGN,
  enrollCampaign,
  personalizeForContact,
  regenerateStep,
  resumePipeline,
  sweepDueEnrollments,
} from '@sutra/agents';
import {
  approveCampaign as approveCampaignContent,
  audit,
  Campaigns,
  Companies,
  Contacts,
  Enrollments,
  WorkspaceSettings,
} from '@sutra/db';
import type { Campaign, CampaignVariant, Contact, Locale } from '@sutra/domain';
import {
  campaignTransitions,
  count,
  enrollmentTransitions,
  fillMergeFields,
  id,
  locale as localeSchema,
} from '@sutra/domain';
import { z } from 'zod';
import { AppError, action } from '@/lib/action';
import { enqueue } from '@/lib/jobs';
import { mainPipeline } from '@/lib/pipeline';

/** The one place a variant's content changes: its approval (content hash) is always voided here. */
function replaceVariant(
  campaign: Campaign,
  stepIndex: number,
  variantId: string,
  apply: (v: CampaignVariant) => CampaignVariant,
): Campaign['steps'] {
  return campaign.steps.map((step, i) =>
    i === stepIndex
      ? {
          ...step,
          variants: step.variants.map((v) => (v.id === variantId ? apply(v) : v)),
        }
      : step,
  );
}

const draftAgain = (v: CampaignVariant): CampaignVariant => {
  const { approvedHash: _h, approvedBy: _b, approvedAt: _a, ...rest } = v;
  return { ...rest, status: 'draft' };
};

/**
 * Edits one variant inline — the English template, or a locale translation. Editing voids the
 * variant's approval (the content hash changes), so it returns to `draft` and must be re-approved
 * before anything is sent.
 */
export const editVariant = action(
  z.object({
    campaignId: id,
    stepIndex: count,
    variantId: id,
    subject: z.string().max(80).optional(),
    body: z.string().optional(),
    locale: localeSchema.optional(),
  }),
  async ({ workspaceId, user }, { campaignId, stepIndex, variantId, subject, body, locale }) => {
    const campaign = await Campaigns.get(workspaceId, campaignId);
    const variant = campaign?.steps[stepIndex]?.variants.find((v) => v.id === variantId);
    if (!campaign || !variant) throw new AppError('NOT_FOUND', 'That variant no longer exists');

    const steps = replaceVariant(campaign, stepIndex, variantId, (v) => {
      const next = draftAgain(v);
      if (locale) {
        const current = next.translations?.[locale] ?? { subject: v.subject, body: v.body };
        return {
          ...next,
          translations: {
            ...next.translations,
            [locale]: { subject: subject ?? current.subject, body: body ?? current.body },
          },
        };
      }
      return { ...next, subject: subject ?? v.subject, body: body ?? v.body };
    });
    await Campaigns.update(workspaceId, campaignId, { steps });
    await audit(workspaceId, { kind: 'user', id: user.id }, 'variant.edit', {
      entity: 'campaigns',
      entityId: campaignId,
      data: { variantId, locale: locale ?? 'en' },
    });
    return { ok: true as const };
  },
);

/**
 * Regenerates both A/B variants of a step from a reviewer's note (pairs are regenerated together so
 * they keep differing in exactly one dimension). The new variants are fresh drafts.
 */
export const regenerateVariants = action(
  z.object({ campaignId: id, stepIndex: count, note: z.string().max(400).optional() }),
  async ({ workspaceId, user }, { campaignId, stepIndex, note }) => {
    const step = await regenerateStep({ workspaceId, campaignId, stepIndex, note });
    if (!step) throw new AppError('NOT_FOUND', 'That step could not be regenerated');
    await audit(workspaceId, { kind: 'user', id: user.id }, 'variant.regenerate', {
      entity: 'campaigns',
      entityId: campaignId,
      data: { stepIndex, note },
    });
    return { ok: true as const, variants: step.variants.length };
  },
  { role: 'member' },
);

/**
 * Checkpoint 2's approval (owner/admin). Stamps `approvedBy`, `approvedAt` and a content hash on the
 * campaign and each variant, sets the campaign running, then resumes the paused pipeline so the
 * `sender` node enrols the audience — or enrols directly for a seeded/demo workspace with no live run.
 * Nothing is ever sent before this runs, and an edited variant is excluded until it is re-approved.
 */
export const approveCampaign = action(
  z.object({ campaignId: id }),
  async ({ workspaceId, user }, { campaignId }) => {
    const approved = await approveCampaignContent(workspaceId, campaignId, user.id);
    if (!approved) throw new AppError('INVALID', 'That campaign cannot be approved');

    const pipeline = mainPipeline();
    const resumed = pipeline
      ? await resumePipeline(pipeline, workspaceId, CHECKPOINT_CAMPAIGN)
          .then(() => true)
          .catch(() => false)
      : false;
    // The sender node enrols when the pipeline resumes; otherwise enrol here (idempotent either way).
    const enrolled = resumed ? 0 : await enrollCampaign(workspaceId, approved, { enqueue });
    return { ok: true as const, enrolled };
  },
  { role: 'admin' },
);

/** Pauses a running campaign: the engine stops sending until it is resumed (also available via chat). */
export const pauseCampaign = action(
  z.object({ campaignId: id }),
  async ({ workspaceId, user }, { campaignId }) => {
    const campaign = await Campaigns.get(workspaceId, campaignId);
    if (!campaign) throw new AppError('NOT_FOUND', 'That campaign no longer exists');
    if (campaign.status !== 'running')
      throw new AppError('INVALID', 'Only a running campaign can be paused');
    await Campaigns.transition(workspaceId, campaignId, 'running', 'paused', campaignTransitions);
    await audit(workspaceId, { kind: 'user', id: user.id }, 'campaign.pause', {
      entity: 'campaigns',
      entityId: campaignId,
    });
    return { ok: true as const };
  },
);

/** Resumes a paused campaign and re-queues every step that fell due while it was paused. */
export const resumeCampaign = action(
  z.object({ campaignId: id }),
  async ({ workspaceId, user }, { campaignId }) => {
    const campaign = await Campaigns.get(workspaceId, campaignId);
    if (!campaign) throw new AppError('NOT_FOUND', 'That campaign no longer exists');
    if (campaign.status !== 'paused') throw new AppError('INVALID', 'That campaign is not paused');
    await Campaigns.transition(workspaceId, campaignId, 'paused', 'running', campaignTransitions);
    await sweepDueEnrollments(workspaceId, new Date(), enqueue);
    await audit(workspaceId, { kind: 'user', id: user.id }, 'campaign.resume', {
      entity: 'campaigns',
      entityId: campaignId,
    });
    return { ok: true as const };
  },
);

/** Pauses or resumes a single contact's enrollment (a per-contact override, also available via chat). */
export const setContactPaused = action(
  z.object({ enrollmentId: id, paused: z.boolean() }),
  async ({ workspaceId, user }, { enrollmentId, paused }) => {
    const enr = await Enrollments.get(workspaceId, enrollmentId);
    if (!enr) throw new AppError('NOT_FOUND', 'That enrollment no longer exists');
    const [from, to] = paused ? (['active', 'paused'] as const) : (['paused', 'active'] as const);
    if (enr.status !== from) throw new AppError('INVALID', `Enrollment is ${enr.status}`);
    const nextRunAt = paused ? enr.nextRunAt : (enr.nextRunAt ?? new Date());
    await Enrollments.transition(workspaceId, enrollmentId, from, to, enrollmentTransitions, {
      nextRunAt,
    });
    if (!paused)
      await enqueue(CAMPAIGN_STEP_JOB, { workspaceId, enrollmentId }, { runAt: nextRunAt });
    await audit(
      workspaceId,
      { kind: 'user', id: user.id },
      paused ? 'enrollment.pause' : 'enrollment.resume',
      {
        entity: 'enrollment',
        entityId: enrollmentId,
      },
    );
    return { ok: true as const };
  },
);

/** A contact matching the campaign persona (with its company), to render a real-looking preview. */
async function sampleContact(
  workspaceId: string,
  persona: string | undefined,
): Promise<{ contact: Contact; company: Awaited<ReturnType<typeof Companies.get>> } | undefined> {
  const [contact] =
    (persona && (await Contacts.find(workspaceId, { personaMatch: persona }, { limit: 1 }))) ||
    (await Contacts.find(workspaceId, {}, { limit: 1 }));
  if (!contact) return undefined;
  return { contact, company: await Companies.get(workspaceId, contact.companyId) };
}

/**
 * Renders a variant for a real sample contact in a chosen locale: picks the locale's translation
 * (or the English template), writes the grounded `{{personalization}}` line for that contact, and
 * fills the merge fields — so the reviewer sees exactly what would be sent, with a cited source.
 */
export const previewVariant = action(
  z.object({ campaignId: id, stepIndex: count, variantId: id, locale: localeSchema.optional() }),
  async ({ workspaceId }, { campaignId, stepIndex, variantId, locale }) => {
    const campaign = await Campaigns.get(workspaceId, campaignId);
    const variant = campaign?.steps[stepIndex]?.variants.find((v) => v.id === variantId);
    if (!campaign || !variant) throw new AppError('NOT_FOUND', 'That variant no longer exists');

    const sample = await sampleContact(workspaceId, campaign.persona);
    const settings = await WorkspaceSettings.findOne(workspaceId, {});
    const view: Locale = locale ?? sample?.contact.locale ?? 'en';
    const template =
      view !== 'en' && variant.translations?.[view]
        ? variant.translations[view]
        : { subject: variant.subject, body: variant.body };

    const personalization =
      sample?.company && sample.contact
        ? await personalizeForContact({
            workspaceId,
            contact: sample.contact,
            company: sample.company,
            campaignId,
            stepIndex,
          })
        : undefined;

    const values = {
      firstName: sample?.contact.firstName ?? sample?.contact.name?.split(' ')[0] ?? 'there',
      company: sample?.company?.name ?? 'your company',
      senderName: settings?.senderName ?? 'Your name',
      personalization: personalization?.line ?? '',
    };
    return {
      locale: view,
      subject: fillMergeFields(template.subject, values),
      body: fillMergeFields(template.body, values),
      personalizationSource: personalization?.sourceUrl,
      contact: sample ? { name: sample.contact.name ?? sample.contact.email } : undefined,
    };
  },
);
