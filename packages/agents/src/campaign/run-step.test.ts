import type { Decision } from '@sutra/compliance';
import {
  Campaigns,
  Companies,
  Consents,
  Contacts,
  Enrollments,
  Messages,
  migrate,
  newId,
  variantHash,
  WorkspaceSettings,
} from '@sutra/db';
import type { CampaignVariant } from '@sutra/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import type { JobOptions, JobPayload } from '../jobs.ts';
import { enrollCampaign } from './enroll.ts';
import { CAMPAIGN_STEP_JOB, DELIVER_JOB, runStep, sweepDueEnrollments } from './run-step.ts';

/** Tuesday 13 Oct 2026, 10:00 in Singapore (inside the send window). */
const AT = new Date('2026-10-13T02:00:00Z');
const DAY = 86_400_000;

beforeAll(() => migrate());

/** A recorder that stands in for the job seam, so no `deliver` handler is needed. */
function recorder() {
  const calls: { name: string; payload: JobPayload; opts?: JobOptions }[] = [];
  const enqueue = async (name: string, payload: JobPayload, opts?: JobOptions) => {
    calls.push({ name, payload, opts });
  };
  return { calls, enqueue };
}

function variant(over: Partial<CampaignVariant> = {}): CampaignVariant {
  const v = {
    id: newId(),
    status: 'active' as const,
    origin: 'initial' as const,
    dimension: 'subject' as const,
    hypothesis: 'h',
    subject: 'Packaging for {{company}}',
    body: 'Hi {{firstName}},\n\nWe print cups.\n\n{{senderName}}',
    ...over,
  };
  return 'approvedHash' in over ? v : { ...v, approvedHash: variantHash(v) };
}

/** A workspace with one approved two-step campaign, a contact with consent, and one enrollment. */
async function setup(opts: { steps?: CampaignVariant[][]; status?: 'active' } = {}) {
  const ws = newId();
  await WorkspaceSettings.create(ws, {
    senderName: 'Mei Tan',
    physicalAddress: '1 Demo Street, Singapore',
    homeCountry: 'SG',
    timezone: 'Asia/Singapore',
    businessHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    warmup: {},
  });
  const company = await Companies.create(ws, {
    name: 'Acme',
    normalizedName: 'acme',
    domain: 'acme.example',
    country: 'SG',
    sources: [{ source: 'search', ref: 'q', at: AT }],
  });
  const contact = await Contacts.create(ws, {
    companyId: company._id,
    firstName: 'Ana',
    email: 'ana@acme.example',
    emailConfidence: 'verified',
    personaMatch: 'Head of Ops',
    locale: 'en',
    timezone: 'Asia/Singapore',
    status: 'contacted',
  });
  await Consents.create(ws, {
    contactId: contact._id,
    basis: 'legitimate_interest',
    source: 'public_page',
    evidence: 'https://acme.example/team',
    at: AT,
  });
  const variants = opts.steps ?? [[variant()], [variant()]];
  const campaign = await Campaigns.create(ws, {
    name: 'C',
    icpVersion: 1,
    persona: 'Head of Ops',
    steps: variants.map((vs, i) => ({ delayDays: i === 0 ? 0 : 3, variants: vs })),
    status: 'running',
  });
  const enrollment = await Enrollments.create(ws, {
    contactId: contact._id,
    campaignId: campaign._id,
    stepIndex: 0,
    status: 'active',
    assignedVariants: {},
    nextRunAt: AT,
  });
  return { ws, company, contact, campaign, enrollment };
}

describe('runStep — send', () => {
  it('queues a message, assigns a variant, enqueues delivery and schedules the next step', async () => {
    const { ws, enrollment, campaign } = await setup();
    const { calls, enqueue } = recorder();
    await runStep({ workspaceId: ws, enrollmentId: enrollment._id }, { now: AT, enqueue });

    const messages = await Messages.find(ws, { enrollmentId: enrollment._id });
    expect(messages).toHaveLength(1);
    const message = messages[0];
    expect(message?.status).toBe('queued');
    expect(message?.stepIndex).toBe(0);
    expect(message?.to).toBe('ana@acme.example');
    expect(message?.subject).toBe('Packaging for Acme'); // merge fields filled
    expect(message?.body).toContain('Hi Ana,');

    const variantId = campaign.steps[0]?.variants[0]?.id;
    const updated = await Enrollments.get(ws, enrollment._id);
    expect(updated?.assignedVariants['0']).toBe(variantId);
    expect(updated?.stepIndex).toBe(1);
    // Step 2 is +3 days, inside the next business morning.
    expect(updated?.nextRunAt?.getTime()).toBeGreaterThan(AT.getTime() + 2 * DAY);

    expect(calls.find((c) => c.name === DELIVER_JOB)?.payload).toEqual({
      workspaceId: ws,
      messageId: message?._id,
    });
    const step = calls.find((c) => c.name === CAMPAIGN_STEP_JOB);
    expect(step?.opts?.runAt).toEqual(updated?.nextRunAt);
  });

  it('is idempotent: a second tick for the same step never sends twice', async () => {
    const { ws, enrollment } = await setup();
    const { enqueue } = recorder();
    await runStep({ workspaceId: ws, enrollmentId: enrollment._id }, { now: AT, enqueue });
    // Rewind the enrollment to the same step and run again (a duplicate/ retried job).
    await Enrollments.update(ws, enrollment._id, { stepIndex: 0, nextRunAt: AT });
    await runStep({ workspaceId: ws, enrollmentId: enrollment._id }, { now: AT, enqueue });
    expect(await Messages.count(ws, { enrollmentId: enrollment._id })).toBe(1);
  });

  it('completes the enrollment after the last step', async () => {
    const { ws, enrollment } = await setup({ steps: [[variant()]] });
    const { enqueue } = recorder();
    await runStep({ workspaceId: ws, enrollmentId: enrollment._id }, { now: AT, enqueue });
    const updated = await Enrollments.get(ws, enrollment._id);
    expect(updated?.status).toBe('completed');
    expect(updated?.stopReason).toBe('campaign_done');
    expect(updated?.nextRunAt).toBeUndefined();
  });
});

describe('runStep — nothing is sent without approval', () => {
  it('skips a step whose only variant was edited back to draft', async () => {
    const { ws, enrollment } = await setup({
      steps: [[variant({ status: 'draft', approvedHash: undefined })], [variant()]],
    });
    const { enqueue } = recorder();
    await runStep({ workspaceId: ws, enrollmentId: enrollment._id }, { now: AT, enqueue });
    expect(await Messages.count(ws, { enrollmentId: enrollment._id })).toBe(0);
    expect((await Enrollments.get(ws, enrollment._id))?.stepIndex).toBe(1);
  });

  it('does nothing while the campaign is paused', async () => {
    const { ws, enrollment, campaign } = await setup();
    await Campaigns.update(ws, campaign._id, { status: 'paused' });
    const { enqueue } = recorder();
    await runStep({ workspaceId: ws, enrollmentId: enrollment._id }, { now: AT, enqueue });
    expect(await Messages.count(ws, { enrollmentId: enrollment._id })).toBe(0);
    expect((await Enrollments.get(ws, enrollment._id))?.stepIndex).toBe(0);
  });
});

describe('runStep — reply and compliance', () => {
  it('stops every later step once the contact replies', async () => {
    const { ws, enrollment, contact, campaign } = await setup();
    await Messages.create(ws, {
      contactId: contact._id,
      campaignId: campaign._id,
      direction: 'inbound',
      status: 'received',
      subject: 'Re: hi',
      body: 'Interested!',
      idempotencyKey: `in:${enrollment._id}`,
    });
    const { enqueue } = recorder();
    await runStep({ workspaceId: ws, enrollmentId: enrollment._id }, { now: AT, enqueue });
    const updated = await Enrollments.get(ws, enrollment._id);
    expect(updated?.status).toBe('stopped');
    expect(updated?.stopReason).toBe('replied');
    expect(await Messages.count(ws, { enrollmentId: enrollment._id, direction: 'outbound' })).toBe(
      0,
    );
  });

  it('reschedules on a temporary compliance block', async () => {
    const { ws, enrollment } = await setup();
    const retryAt = new Date(AT.getTime() + DAY);
    const blocked: Decision = {
      allow: false,
      pack: 'SG',
      packVersion: '2026.01',
      reasons: [{ code: 'outside_send_window', message: 'closed', retryAt }],
      retryAt,
    };
    const { calls, enqueue } = recorder();
    await runStep(
      { workspaceId: ws, enrollmentId: enrollment._id },
      { now: AT, enqueue, checkFor: async () => blocked },
    );
    expect(await Messages.count(ws, { enrollmentId: enrollment._id })).toBe(0);
    expect((await Enrollments.get(ws, enrollment._id))?.nextRunAt).toEqual(retryAt);
    expect(calls.find((c) => c.name === CAMPAIGN_STEP_JOB)?.opts?.runAt).toEqual(retryAt);
  });

  it('stops the enrollment on a permanent block (suppressed)', async () => {
    const { ws, enrollment } = await setup();
    const blocked: Decision = {
      allow: false,
      pack: 'SG',
      packVersion: '2026.01',
      reasons: [{ code: 'suppressed', message: 'suppressed' }],
    };
    const { enqueue } = recorder();
    await runStep(
      { workspaceId: ws, enrollmentId: enrollment._id },
      { now: AT, enqueue, checkFor: async () => blocked },
    );
    const updated = await Enrollments.get(ws, enrollment._id);
    expect(updated?.status).toBe('stopped');
    expect(updated?.stopReason).toBe('opted_out');
  });
});

describe('enrollCampaign & sweep', () => {
  it('enrols the persona audience, schedules first steps, and is idempotent', async () => {
    const { ws, campaign } = await setup();
    // Remove the enrollment the fixture created so enrolment starts clean.
    await Enrollments.col().deleteMany({ workspaceId: ws });
    const { calls, enqueue } = recorder();

    const first = await enrollCampaign(ws, campaign, { now: AT, enqueue });
    expect(first).toBe(1);
    expect(await Enrollments.count(ws, { campaignId: campaign._id })).toBe(1);
    expect(calls.filter((c) => c.name === CAMPAIGN_STEP_JOB)).toHaveLength(1);

    const again = await enrollCampaign(ws, campaign, { now: AT, enqueue });
    expect(again).toBe(0); // already enrolled
    expect(await Enrollments.count(ws, { campaignId: campaign._id })).toBe(1);
  });

  it('sweeps due active enrollments back onto the queue', async () => {
    const { ws, enrollment } = await setup();
    await Enrollments.update(ws, enrollment._id, { nextRunAt: new Date(AT.getTime() - DAY) });
    const { calls, enqueue } = recorder();
    const swept = await sweepDueEnrollments(ws, AT, enqueue);
    expect(swept).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: CAMPAIGN_STEP_JOB,
      payload: { enrollmentId: enrollment._id },
    });
  });
});
