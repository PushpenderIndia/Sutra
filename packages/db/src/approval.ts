import { createHash } from 'node:crypto';
import type { CampaignVariant, Id } from '@sutra/domain';
import { Campaigns } from './collections.ts';

declare const approved: unique symbol;

/**
 * A send permit for one variant's content. Only `approvedVariant()` creates one (the brand isn't
 * exported), so a send function typed `(approval: ApprovedVariant) => …` can't be called for
 * content a person hasn't approved.
 */
export interface ApprovedVariant {
  campaignId: Id;
  variantId: Id;
  /** The approved content hash; it matched the variant's current content when issued. */
  hash: string;
  readonly [approved]: true;
}

/** Hash of the content a person approves; any edit changes it, which voids the approval. */
export const variantHash = (v: Pick<CampaignVariant, 'subject' | 'body' | 'translations'>) =>
  createHash('sha256')
    .update(JSON.stringify([v.subject, v.body, v.translations ?? {}]))
    .digest('hex');

const SENDABLE_CAMPAIGN = new Set(['approved', 'running']);
const SENDABLE_VARIANT = new Set(['approved', 'active']);

/**
 * The permit for sending `variantId`, or `null` unless its campaign is approved or running, the
 * variant is approved or active, and its content still matches the hash stored at approval.
 */
export async function approvedVariant(
  workspaceId: Id,
  campaignId: Id,
  variantId: Id,
): Promise<ApprovedVariant | null> {
  const campaign = await Campaigns.get(workspaceId, campaignId);
  if (!campaign || !SENDABLE_CAMPAIGN.has(campaign.status)) return null;
  const variant = campaign.steps.flatMap((s) => s.variants).find((v) => v.id === variantId);
  if (!variant?.approvedHash || !SENDABLE_VARIANT.has(variant.status)) return null;
  if (variant.approvedHash !== variantHash(variant)) return null;
  return { campaignId, variantId, hash: variant.approvedHash } as ApprovedVariant;
}
