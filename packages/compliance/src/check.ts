import type { Company, Consent, Contact, Suppression, WorkspaceSettings } from '@sutra/domain';
import { DEFAULT, PACKS } from '../packs/index.ts';
import { domainOf, domainsOf, emailHash, isPersonalEmail } from './address.ts';
import { type Pack, packOverride, tighten } from './pack.ts';
import { DAY, nextMidnight, nextOpen } from './time.ts';

export type Requirement =
  | 'unsubscribe_link'
  | 'list_unsubscribe_header'
  | 'sender_identity'
  | 'physical_address';

export type ReasonCode =
  | 'suppressed'
  | 'personal_email_without_consent'
  | 'no_lawful_basis'
  | 'no_send_window'
  | 'outside_send_window'
  | 'contact_frequency_cap'
  | 'domain_frequency_cap'
  | 'mailbox_daily_cap'
  | 'missing_requirement';

export interface Reason {
  code: ReasonCode;
  message: string;
  /** Set when the block is temporary: the earliest time this rule allows the send. */
  retryAt?: Date;
}

interface DecisionBase {
  /** Country of the pack applied (`DEFAULT` for unknown countries) and its version. */
  pack: string;
  packVersion: string;
}

declare const allowed: unique symbol;

/**
 * A send permit. Only `check()` can produce one (the brand isn't exported), so a send function
 * typed `(decision: AllowDecision) => …` can't be called without passing compliance.
 */
export interface AllowDecision extends DecisionBase {
  allow: true;
  /** What the outgoing message must include. */
  requirements: Requirement[];
  readonly [allowed]: true;
}

export interface BlockDecision extends DecisionBase {
  allow: false;
  /** Every rule that failed, most serious first. */
  reasons: Reason[];
  /** Set only when every reason is temporary: reschedule the send for then. */
  retryAt?: Date;
}

export type Decision = AllowDecision | BlockDecision;

export interface CheckInput {
  contact: Pick<Contact, 'email' | 'timezone' | 'status'>;
  company: Pick<Company, 'country' | 'domain'>;
  /** Evaluation time, normally now. */
  at: Date;
  workspace: Pick<
    WorkspaceSettings,
    | 'senderName'
    | 'physicalAddress'
    | 'timezone'
    | 'dailySendCap'
    | 'warmup'
    | 'complianceOverrides'
  >;
  /** The contact's lawful-basis records. */
  consents: Pick<Consent, 'basis' | 'evidence'>[];
  /** Suppressions that may match; non-matching ones are ignored. */
  suppressions: Pick<Suppression, 'kind' | 'scope' | 'value'>[];
  /** Earlier sends to this contact (the last 7 days is enough). */
  recentSends: { at: Date }[];
  /** Earlier sends to anyone at the contact's domain (the last 24 hours is enough). */
  domainSends: { at: Date }[];
  /** Sends from this workspace's mailbox since local midnight (workspace time zone). */
  mailboxSentToday: number;
  /** Days since the mailbox's first send; 0 on the first day. Drives the warm-up ramp. */
  mailboxDay: number;
}

/** The pack for `country` with the workspace's stricter-only overrides applied. */
export function packFor(
  country: string,
  overrides: WorkspaceSettings['complianceOverrides'] = {},
  packs: Readonly<Record<string, Pack>> = PACKS,
): Pack {
  const base = packs[country] ?? DEFAULT;
  const parsed = packOverride.safeParse(overrides[base.country]);
  return parsed.success ? tighten(base, parsed.data) : base;
}

/** Today's mailbox cap: the daily cap, or the warm-up ramp while it's still climbing. */
export function mailboxCap(workspace: CheckInput['workspace'], day: number) {
  const { enabled, startPerDay, increasePerDay, max } = workspace.warmup;
  const ramp = enabled ? Math.min(max, startPerDay + increasePerDay * day) : Infinity;
  return Math.min(workspace.dailySendCap, ramp);
}

/** When a rolling-window cap frees up, or `undefined` if there's room. */
function capped(sends: { at: Date }[], at: Date, span: number, cap: number) {
  const since = at.getTime() - span;
  const inWindow = sends.map((s) => s.at.getTime()).filter((t) => t > since);
  if (inWindow.length < cap) return undefined;
  const oldestThatMustExpire = inWindow.sort((a, b) => a - b)[inWindow.length - cap] as number;
  return new Date(oldestThatMustExpire + span);
}

const REQUIREMENTS = [
  ['unsubscribe_link', 'unsubscribe'],
  ['list_unsubscribe_header', 'listUnsubscribeHeader'],
  ['sender_identity', 'senderIdentity'],
  ['physical_address', 'physicalAddress'],
] as const;

/**
 * The compliance gate: may this email be sent to this contact now? Pure (no I/O) and
 * deterministic. Every rule is evaluated and every failure is reported, so a report can say
 * exactly why a contact is blocked. `@sutra/db` `checkFor()` gathers the inputs.
 */
export function check(input: CheckInput, packs: Readonly<Record<string, Pack>> = PACKS): Decision {
  const { contact, company, at, workspace } = input;
  const p = packFor(company.country, workspace.complianceOverrides, packs);
  const meta = { pack: p.country, packVersion: p.version };
  const reasons: Reason[] = [];
  const block = (code: ReasonCode, message: string, retryAt?: Date) =>
    reasons.push({ code, message, ...(retryAt && { retryAt }) });

  // 1. Suppression: the address, its domain (or a parent domain), or an erased person's hash.
  const email = contact.email.toLowerCase();
  const domains = new Set(
    domainsOf(domainOf(email)).concat(company.domain ? domainsOf(company.domain) : []),
  );
  const hash = emailHash(email);
  for (const s of input.suppressions) {
    const hit =
      s.scope === 'domain'
        ? domains.has(s.value)
        : s.value === (s.scope === 'email' ? email : hash);
    if (hit)
      block('suppressed', `${s.scope === 'domain' ? 'Domain' : 'Address'} suppressed (${s.kind})`);
  }
  if (contact.status === 'suppressed') block('suppressed', 'Contact is suppressed');

  // 2. Lawful basis. Legitimate interest only counts with evidence (the public page URL).
  const bases = input.consents
    .filter((c) => p.email.basis.includes(c.basis))
    .filter((c) => c.basis !== 'legitimate_interest' || /^https?:\/\//.test(c.evidence))
    .map((c) => c.basis);
  if (p.email.b2bOnly && isPersonalEmail(email)) {
    if (!bases.some((b) => b !== 'legitimate_interest'))
      block('personal_email_without_consent', 'Personal address: needs explicit consent');
  } else if (!bases.length) {
    block('no_lawful_basis', `No lawful basis accepted in ${p.name} (${p.email.basis.join(', ')})`);
  }

  // 3. Send window in the contact's time zone.
  const opens = nextOpen(at, p.sendWindow, contact.timezone);
  if (!opens) block('no_send_window', `The ${p.name} send window is empty`);
  else if (opens > at) block('outside_send_window', `Outside ${p.name} sending hours`, opens);

  // 4. Frequency caps.
  const perContact = capped(input.recentSends, at, 7 * DAY, p.frequency.perContactPerWeek);
  if (perContact)
    block('contact_frequency_cap', 'Weekly limit for this contact reached', perContact);
  const perDomain = capped(input.domainSends, at, DAY, p.frequency.perDomainPerDay);
  if (perDomain) block('domain_frequency_cap', 'Daily limit for this company reached', perDomain);

  // 5. Mailbox daily cap and warm-up ramp.
  if (input.mailboxSentToday >= mailboxCap(workspace, input.mailboxDay))
    block(
      'mailbox_daily_cap',
      "Today's mailbox limit reached",
      nextMidnight(at, workspace.timezone),
    );

  // 6. Requirements the message must carry; a required one we can't fill blocks the send.
  const available: Record<Requirement, boolean> = {
    unsubscribe_link: true,
    list_unsubscribe_header: true,
    sender_identity: workspace.senderName.trim() !== '',
    physical_address: !!workspace.physicalAddress?.trim(),
  };
  const requirements: Requirement[] = [];
  for (const [req, key] of REQUIREMENTS) {
    if (available[req]) requirements.push(req);
    else if (p.email[key] === 'required')
      block('missing_requirement', `Workspace has no ${req.replace('_', ' ')}`);
  }

  if (!reasons.length) return { allow: true, requirements, ...meta } as AllowDecision;
  // Retry when the last temporary block lifts, re-aligned to the send window (a cap may lift at night).
  const retryAt = reasons.every((r) => r.retryAt)
    ? nextOpen(
        new Date(Math.max(...reasons.map((r) => Number(r.retryAt)))),
        p.sendWindow,
        contact.timezone,
      )
    : undefined;
  return { allow: false, reasons, ...meta, ...(retryAt && { retryAt }) };
}
