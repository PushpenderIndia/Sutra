import type { CampaignStep, Id } from '@sutra/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { approveCampaign, approvedVariant, campaignHash, variantHash } from './approval.ts';
import { Campaigns } from './collections.ts';
import { migrate } from './migrate.ts';
import { newId } from './repository.ts';

beforeAll(() => migrate());

const draftVariant = (over: Record<string, unknown> = {}) => ({
  id: newId(),
  status: 'draft' as const,
  origin: 'initial' as const,
  dimension: 'subject' as const,
  hypothesis: 'h',
  subject: 'Packaging for {{company}}',
  body: 'Hi {{firstName}}',
  ...over,
});

async function draftCampaign(ws: Id, steps?: CampaignStep[]) {
  return Campaigns.create(ws, {
    name: 'C',
    icpVersion: 1,
    status: 'draft',
    steps: steps ?? [{ delayDays: 0, variants: [draftVariant(), draftVariant()] }],
  });
}

describe('approveCampaign', () => {
  it('stamps the approver, time and content hash and makes variants sendable', async () => {
    const ws = newId();
    const campaign = await draftCampaign(ws);
    const approved = await approveCampaign(ws, campaign._id, 'user-1');

    expect(approved?.status).toBe('running');
    expect(approved?.approvedBy).toBe('user-1');
    expect(approved?.approvedAt).toBeInstanceOf(Date);
    expect(approved?.approvedHash).toBe(campaignHash(approved?.steps ?? []));
    for (const v of approved?.steps[0]?.variants ?? []) {
      expect(v.status).toBe('active');
      expect(v.approvedHash).toBe(variantHash(v));
      expect(v.approvedBy).toBe('user-1');
    }

    // A send permit is now issued for each approved variant.
    const variantId = approved?.steps[0]?.variants[0]?.id as string;
    const permit = await approvedVariant(ws, campaign._id, variantId);
    expect(permit?.variantId).toBe(variantId);
  });

  it('never issues a permit for an edited (unapproved) variant until it is re-approved', async () => {
    const ws = newId();
    const campaign = await draftCampaign(ws);
    const approved = await approveCampaign(ws, campaign._id, 'user-1');
    const variantId = approved?.steps[0]?.variants[0]?.id as string;

    // Simulate an inline edit: content changes and the variant drops back to draft (actions/editVariant).
    const steps = (approved?.steps ?? []).map((s) => ({
      ...s,
      variants: s.variants.map((v) =>
        v.id === variantId
          ? {
              ...v,
              subject: 'A brand new subject',
              status: 'draft' as const,
              approvedHash: undefined,
            }
          : v,
      ),
    }));
    await Campaigns.update(ws, campaign._id, { steps });

    expect(await approvedVariant(ws, campaign._id, variantId)).toBeNull();
    // Its untouched sibling is still sendable.
    const siblingId = approved?.steps[0]?.variants[1]?.id as string;
    expect(await approvedVariant(ws, campaign._id, siblingId)).not.toBeNull();

    // Re-approval restores the permit with the new content's hash.
    const reapproved = await approveCampaign(ws, campaign._id, 'user-2');
    const permit = await approvedVariant(ws, campaign._id, variantId);
    expect(permit).not.toBeNull();
    expect(permit?.hash).toBe(variantHash(reapproved?.steps[0]?.variants[0] ?? ({} as never)));
  });

  it('refuses to approve a finished campaign', async () => {
    const ws = newId();
    const campaign = await draftCampaign(ws);
    await Campaigns.update(ws, campaign._id, { status: 'done' });
    expect(await approveCampaign(ws, campaign._id, 'user-1')).toBeNull();
  });
});
