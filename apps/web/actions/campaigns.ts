'use server';
import { personalizeForContact, regenerateStep } from '@sutra/agents';
import { audit, Campaigns, Companies, Contacts, WorkspaceSettings } from '@sutra/db';
import type { Campaign, CampaignVariant, Contact, Locale } from '@sutra/domain';
import { count, fillMergeFields, id, locale as localeSchema } from '@sutra/domain';
import { z } from 'zod';
import { AppError, action } from '@/lib/action';

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
