import { Campaigns, Companies, Consents, Contacts, Enrollments, newId } from '@sutra/db';
import type { Id } from '@sutra/domain';
import { describe, expect, it } from 'vitest';
import { auth } from '@/lib/auth';
import { as, signIn, signUp } from '@/test/request';
import { approveCampaign, pauseCampaign, resumeCampaign, setContactPaused } from './campaigns';
import { createWorkspace } from './workspace';

const draftVariant = () => ({
  id: newId(),
  status: 'draft' as const,
  origin: 'initial' as const,
  dimension: 'subject' as const,
  hypothesis: 'h',
  subject: 'Packaging for {{company}}',
  body: 'Hi {{firstName}},\n\nWe print cups.\n\n{{senderName}}',
});

/** An owner with a workspace holding one draft campaign, a persona contact (with consent). */
async function setup(email: string) {
  const owner = await signUp(email);
  as(owner.headers);
  await expect(
    createWorkspace({ website: 'acme.example', timezone: 'Asia/Singapore' }),
  ).rejects.toThrow('NEXT_REDIRECT');
  const session = await auth.api.getSession({ headers: owner.headers });
  const ws = session?.session.activeOrganizationId as Id;

  const company = await Companies.create(ws, {
    name: 'Acme',
    normalizedName: 'acme',
    domain: 'acme.example',
    country: 'SG',
    sources: [{ source: 'search', ref: 'q', at: new Date() }],
  });
  const contact = await Contacts.create(ws, {
    companyId: company._id,
    firstName: 'Ana',
    email: 'ana@acme.example',
    emailConfidence: 'verified',
    personaMatch: 'Head of Ops',
    locale: 'en',
    timezone: 'Asia/Singapore',
    status: 'new',
  });
  await Consents.create(ws, {
    contactId: contact._id,
    basis: 'legitimate_interest',
    source: 'public_page',
    evidence: 'https://acme.example/team',
    at: new Date(),
  });
  const campaign = await Campaigns.create(ws, {
    name: 'C',
    icpVersion: 1,
    persona: 'Head of Ops',
    status: 'draft',
    steps: [{ delayDays: 0, variants: [draftVariant(), draftVariant()] }],
  });
  return { ws, owner, campaign, contact };
}

describe('campaign approval actions', () => {
  it('only an admin can approve; approval stamps hashes, runs the campaign and enrols the audience', async () => {
    const { ws, owner, campaign } = await setup('owner-a@example.com');
    const member = await signUp('member-a@example.com');
    await auth.api.addMember({
      body: { userId: member.user.id, organizationId: ws, role: 'member' },
    });

    // A member is refused.
    as(await signIn('member-a@example.com'));
    expect(await approveCampaign({ campaignId: campaign._id })).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    // Nothing was approved, so no one is enrolled.
    expect(await Enrollments.count(ws, { campaignId: campaign._id })).toBe(0);

    // The owner approves.
    as(owner.headers);
    const res = await approveCampaign({ campaignId: campaign._id });
    expect(res.ok).toBe(true);

    const approved = await Campaigns.get(ws, campaign._id);
    expect(approved?.status).toBe('running');
    expect(approved?.approvedBy).toBe(owner.user.id);
    expect(approved?.approvedHash).toBeTruthy();
    for (const v of approved?.steps[0]?.variants ?? []) {
      expect(v.status).toBe('active');
      expect(v.approvedHash).toBeTruthy();
    }
    // The one persona contact is enrolled.
    expect(await Enrollments.count(ws, { campaignId: campaign._id })).toBe(1);
  });

  it('refuses to approve a campaign that is already done', async () => {
    const { ws, owner, campaign } = await setup('owner-b@example.com');
    await Campaigns.update(ws, campaign._id, { status: 'done' });
    as(owner.headers);
    expect(await approveCampaign({ campaignId: campaign._id })).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
  });

  it('pauses and resumes a running campaign, and a single contact', async () => {
    const { ws, owner, campaign } = await setup('owner-c@example.com');
    as(owner.headers);
    await approveCampaign({ campaignId: campaign._id });

    expect((await pauseCampaign({ campaignId: campaign._id })).ok).toBe(true);
    expect((await Campaigns.get(ws, campaign._id))?.status).toBe('paused');
    // Can't pause again.
    expect(await pauseCampaign({ campaignId: campaign._id })).toMatchObject({ ok: false });

    expect((await resumeCampaign({ campaignId: campaign._id })).ok).toBe(true);
    expect((await Campaigns.get(ws, campaign._id))?.status).toBe('running');

    const [enr] = await Enrollments.find(ws, { campaignId: campaign._id });
    if (enr?.status === 'active') {
      expect((await setContactPaused({ enrollmentId: enr._id, paused: true })).ok).toBe(true);
      expect((await Enrollments.get(ws, enr._id))?.status).toBe('paused');
      expect((await setContactPaused({ enrollmentId: enr._id, paused: false })).ok).toBe(true);
      expect((await Enrollments.get(ws, enr._id))?.status).toBe('active');
    }
  });
});
