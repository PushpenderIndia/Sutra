import 'server-only';
import { firstSendsByTimezone, warmupRamp } from '@sutra/agents';
import {
  Companies,
  Contacts,
  checkFor,
  isDemoMode,
  Mailboxes,
  Messages,
  summarize,
} from '@sutra/db';
import type { Campaign, Country, Id, WorkspaceSettings as Settings } from '@sutra/domain';
import { FAKE_USER } from '@sutra/mail';

const DAY = 86_400_000;

/** What Checkpoint 2 summarises for a campaign that is being approved. All fields are serialisable. */
export interface ApprovalView {
  /** Contacts in this campaign's audience (its persona, excluding suppressed/excluded). */
  audience: number;
  /** New variants still awaiting approval. */
  pending: number;
  mailboxConnected: boolean;
  /** PR 10 compliance dry run over the whole audience; only computed before approval. */
  compliance?: { ready: number; blocked: number; text: string };
  /** First send per contact time zone (ISO), for the schedule preview. */
  schedule?: { timezone: string; count: number; first: string }[];
  /** The mailbox warm-up ramp for the next few days. */
  warmup?: { day: number; cap: number }[];
}

/** Days since the mailbox's first send, which the warm-up ramp climbs from (0 before any send). */
async function mailboxDay(workspaceId: Id, now: Date): Promise<number> {
  const [first] = await Messages.find(
    workspaceId,
    { direction: 'outbound', sentAt: { $exists: true } },
    { sort: { sentAt: 1 }, limit: 1, projection: { sentAt: 1 } },
  );
  if (!first?.sentAt) return 0;
  return Math.max(0, Math.floor((now.getTime() - first.sentAt.getTime()) / DAY));
}

/**
 * Builds Checkpoint 2's approval summary for one campaign: audience size, pending variants, mailbox
 * status and — before approval — the compliance dry run, schedule preview and warm-up ramp. The
 * compliance pass runs the PR 10 gate over every audience contact, so it is skipped once a campaign
 * is running.
 */
export async function approvalView(
  workspaceId: Id,
  campaign: Campaign,
  settings: Settings | null,
  mailboxConnected: boolean,
  now = new Date(),
): Promise<ApprovalView> {
  const pending = campaign.steps
    .flatMap((s) => s.variants)
    .filter((v) => v.status === 'pending_approval').length;

  const contacts = await Contacts.find(workspaceId, {
    ...(campaign.persona ? { personaMatch: campaign.persona } : {}),
    status: { $nin: ['suppressed', 'excluded'] },
  });
  const base: ApprovalView = { audience: contacts.length, pending, mailboxConnected };

  // Only the heavy dry run / preview for campaigns still awaiting approval.
  if (campaign.status !== 'draft' && campaign.status !== 'pending_approval') return base;

  const decisions = await Promise.all(
    contacts.map((c) => checkFor(workspaceId, c._id, { at: now })),
  );
  const { ready, blocked, text } = summarize(decisions);

  const companies = await Companies.find(workspaceId, {
    _id: { $in: [...new Set(contacts.map((c) => c.companyId))] },
  });
  const country = new Map<Id, Country>(companies.map((c) => [c._id, c.country]));
  const schedule = firstSendsByTimezone(
    contacts.map((c) => ({
      timezone: c.timezone,
      country: country.get(c.companyId) ?? 'US',
    })),
    now,
    settings?.complianceOverrides,
  ).map((g) => ({ timezone: g.timezone, count: g.count, first: g.first.toISOString() }));

  const warmup = settings ? warmupRamp(settings, await mailboxDay(workspaceId, now), 5) : undefined;

  return { ...base, compliance: { ready, blocked, text }, schedule, warmup };
}

/**
 * Whether this workspace can send (the Checkpoint 2 "connect Gmail" prompt). Demo mode always can
 * (sending is simulated); live mode needs a connected Gmail mailbox, not the demo `fake` one.
 */
export const hasMailbox = async (workspaceId: Id): Promise<boolean> =>
  (await isDemoMode(workspaceId)) ||
  !!(await Mailboxes.findOne(workspaceId, { userId: { $ne: FAKE_USER } }));
