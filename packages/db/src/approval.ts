import { createHash } from 'node:crypto';
import type { Actor, Campaign, CampaignStep, CampaignVariant, Id } from '@sutra/domain';
import { audit } from './audit.ts';
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

/** Campaigns and variants in these states can be approved; the rest (rejected/retired) are left as-is. */
const APPROVABLE_CAMPAIGN = new Set(['draft', 'pending_approval', 'approved', 'running']);
const APPROVABLE_VARIANT = new Set(['draft', 'pending_approval', 'approved', 'active']);

/** The hash of a whole campaign's approved content: the ordered list of its variants' content hashes. */
export const campaignHash = (steps: CampaignStep[]) =>
  createHash('sha256')
    .update(JSON.stringify(steps.map((s) => s.variants.map((v) => variantHash(v)))))
    .digest('hex');

/** Stamps one variant as approved: it becomes `active`, with the content hash, approver and time. */
const approveVariantContent = (v: CampaignVariant, by: string, at: Date): CampaignVariant =>
  APPROVABLE_VARIANT.has(v.status)
    ? { ...v, status: 'active', approvedHash: variantHash(v), approvedBy: by, approvedAt: at }
    : v;

/**
 * Checkpoint 2's approval. Stamps `approvedBy`, `approvedAt` and a content hash on the campaign and
 * every approvable variant (making each `active`), and sets the campaign `running` so the engine can
 * send. A later edit to a variant voids its hash (it returns to `draft`) and it is excluded from sends
 * until re-approved. Returns the updated campaign, or `null` if it is missing or in a non-approvable
 * state (e.g. already `done`).
 */
export async function approveCampaign(
  workspaceId: Id,
  campaignId: Id,
  by: string,
  at: Date = new Date(),
): Promise<Campaign | null> {
  const campaign = await Campaigns.get(workspaceId, campaignId);
  if (!campaign || !APPROVABLE_CAMPAIGN.has(campaign.status)) return null;
  const steps = campaign.steps.map((s) => ({
    ...s,
    variants: s.variants.map((v) => approveVariantContent(v, by, at)),
  }));
  const updated = await Campaigns.update(workspaceId, campaignId, {
    steps,
    status: 'running',
    approvedBy: by,
    approvedAt: at,
    approvedHash: campaignHash(steps),
  });
  await audit(workspaceId, { kind: 'user', id: by }, 'campaign.approve', {
    entity: 'campaigns',
    entityId: campaignId,
    data: { variants: steps.flatMap((s) => s.variants).length },
  });
  return updated;
}

/** Max active arms per step (PR 15 §4). Approving a fifth must retire one of the four first. */
export const MAX_ACTIVE_ARMS = 4;

const ACTIVE_VARIANT = new Set(['approved', 'active']);

export type ApproveVariantResult =
  | { ok: true; campaign: Campaign }
  | { ok: false; reason: 'not_found' | 'not_approvable' }
  | { ok: false; reason: 'too_many_arms'; active: Id[] };

/**
 * Approves one optimizer-suggested (or draft) challenger: it becomes `active` with its content hash,
 * approver and time, so the bandit starts exploring it. A step may hold at most {@link MAX_ACTIVE_ARMS}
 * active arms; approving one more returns `too_many_arms` with the current active ids, unless
 * `retireVariantId` names one to retire in the same write. Pure guard: nothing is ever sent by this —
 * the engine still needs each send's approved-variant permit, which only an `active` variant has.
 */
export async function approveVariant(
  workspaceId: Id,
  input: { campaignId: Id; stepIndex: number; variantId: Id; retireVariantId?: Id },
  by: string,
  at: Date = new Date(),
): Promise<ApproveVariantResult> {
  const { campaignId, stepIndex, variantId, retireVariantId } = input;
  const campaign = await Campaigns.get(workspaceId, campaignId);
  const step = campaign?.steps[stepIndex];
  const target = step?.variants.find((v) => v.id === variantId);
  if (!campaign || !step || !target) return { ok: false, reason: 'not_found' };
  if (!APPROVABLE_VARIANT.has(target.status) || ACTIVE_VARIANT.has(target.status))
    return { ok: false, reason: 'not_approvable' };

  const active = step.variants.filter(
    (v) => ACTIVE_VARIANT.has(v.status) && v.id !== retireVariantId,
  );
  if (active.length >= MAX_ACTIVE_ARMS)
    return { ok: false, reason: 'too_many_arms', active: active.map((v) => v.id) };

  const variants = step.variants.map((v) => {
    if (v.id === variantId) return approveVariantContent(v, by, at);
    if (v.id === retireVariantId && (v.status === 'active' || v.status === 'paused'))
      return { ...v, status: 'retired' as const };
    return v;
  });
  const steps = campaign.steps.map((s, i) => (i === stepIndex ? { ...s, variants } : s));
  const updated = await Campaigns.update(workspaceId, campaignId, { steps });
  await audit(workspaceId, { kind: 'user', id: by }, 'variant.approve', {
    entity: 'campaigns',
    entityId: campaignId,
    data: { variantId, stepIndex, retired: retireVariantId },
  });
  return updated ? { ok: true, campaign: updated } : { ok: false, reason: 'not_found' };
}

/** Rejects a suggested challenger (`draft`/`pending_approval` → `rejected`); it is never sent. */
export async function rejectVariant(
  workspaceId: Id,
  input: { campaignId: Id; stepIndex: number; variantId: Id },
  by: string,
): Promise<Campaign | null> {
  const { campaignId, stepIndex, variantId } = input;
  const campaign = await Campaigns.get(workspaceId, campaignId);
  const target = campaign?.steps[stepIndex]?.variants.find((v) => v.id === variantId);
  if (!campaign || !target) return null;
  if (!APPROVABLE_VARIANT.has(target.status) || ACTIVE_VARIANT.has(target.status)) return campaign;

  const steps = campaign.steps.map((s, i) =>
    i === stepIndex
      ? {
          ...s,
          variants: s.variants.map((v) =>
            v.id === variantId ? { ...v, status: 'rejected' as const } : v,
          ),
        }
      : s,
  );
  const updated = await Campaigns.update(workspaceId, campaignId, { steps });
  await audit(workspaceId, { kind: 'user', id: by }, 'variant.reject', {
    entity: 'campaigns',
    entityId: campaignId,
    data: { variantId, stepIndex },
  });
  return updated;
}

/** Retires an active/paused variant so the bandit stops assigning it. Idempotent and audited. */
export async function retireVariant(
  workspaceId: Id,
  input: { campaignId: Id; stepIndex: number; variantId: Id },
  by: Actor = { kind: 'system', id: 'optimizer' },
): Promise<Campaign | null> {
  const { campaignId, stepIndex, variantId } = input;
  const campaign = await Campaigns.get(workspaceId, campaignId);
  const target = campaign?.steps[stepIndex]?.variants.find((v) => v.id === variantId);
  if (!campaign || !target) return null;
  if (target.status !== 'active' && target.status !== 'paused') return campaign;

  const steps = campaign.steps.map((s, i) =>
    i === stepIndex
      ? {
          ...s,
          variants: s.variants.map((v) =>
            v.id === variantId ? { ...v, status: 'retired' as const } : v,
          ),
        }
      : s,
  );
  const updated = await Campaigns.update(workspaceId, campaignId, { steps });
  await audit(workspaceId, by, 'variant.retire', {
    entity: 'campaigns',
    entityId: campaignId,
    data: { variantId, stepIndex },
  });
  return updated;
}
