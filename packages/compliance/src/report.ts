import type { ContactStatus } from '@sutra/domain';
import type { Decision, Reason, ReasonCode } from './check.ts';
import type { Pack } from './pack.ts';
import { DAY } from './time.ts';

/** The Prospects tab's compliance column. Temporary blocks (hours, caps) still count as OK. */
export type ComplianceStatus = 'ok' | 'needs_consent' | 'suppressed' | 'blocked';

const STATUS: Record<ReasonCode, ComplianceStatus> = {
  suppressed: 'suppressed',
  personal_email_without_consent: 'needs_consent',
  no_lawful_basis: 'needs_consent',
  no_send_window: 'blocked',
  missing_requirement: 'blocked',
  outside_send_window: 'ok',
  contact_frequency_cap: 'ok',
  domain_frequency_cap: 'ok',
  mailbox_daily_cap: 'ok',
};

/** Short labels for reports, e.g. "5 personal emails without consent". */
export const REASON_LABELS: Record<ReasonCode, string> = {
  suppressed: 'suppressed',
  personal_email_without_consent: 'personal emails without consent',
  no_lawful_basis: 'without a lawful basis',
  no_send_window: 'no send window',
  missing_requirement: 'missing sender details',
  outside_send_window: 'outside sending hours',
  contact_frequency_cap: 'contact weekly cap',
  domain_frequency_cap: 'duplicate domain cap',
  mailbox_daily_cap: 'mailbox daily cap',
};

/** A blocked decision's reasons are ordered most serious first; the first one names it. */
const primary = (reasons: Reason[]) => (reasons[0] as Reason).code;

export const statusOf = (d: Decision): ComplianceStatus =>
  d.allow ? 'ok' : STATUS[primary(d.reasons)];

/**
 * Checkpoint 2's summary: "212 ready · 9 blocked: 5 personal emails without consent,
 * 3 suppressed, 1 duplicate domain cap". Each blocked contact is counted once, by its first reason.
 */
export function summarize(decisions: Decision[]) {
  const byReason: Partial<Record<ReasonCode, number>> = {};
  let ready = 0;
  for (const d of decisions) {
    if (d.allow) ready++;
    else {
      const code = primary(d.reasons);
      byReason[code] = (byReason[code] ?? 0) + 1;
    }
  }
  const blocked = decisions.length - ready;
  const parts = Object.entries(byReason)
    .sort(([, a], [, b]) => b - a)
    .map(([code, n]) => `${n} ${REASON_LABELS[code as ReasonCode]}`);
  const text = `${ready} ready · ${blocked} blocked${parts.length ? `: ${parts.join(', ')}` : ''}`;
  return { ready, blocked, byReason, text };
}

/** Contacts in an active conversation are kept; everyone else expires after `retentionDays`. */
const KEPT: readonly ContactStatus[] = ['engaged', 'interested', 'meeting_booked'];

/** Whether a prospect has been inactive past the pack's retention period. */
export const isStale = (
  contact: { status: ContactStatus; updatedAt: Date },
  pack: Pick<Pack, 'retentionDays'>,
  now: Date,
) =>
  !KEPT.includes(contact.status) &&
  now.getTime() - contact.updatedAt.getTime() > pack.retentionDays * DAY;
