import {
  check,
  DAY,
  DEFAULT,
  type Decision,
  domainOf,
  domainsOf,
  emailHash,
  isStale,
  normalizeEmail,
  PACKS,
  packFor,
  startOfDay,
} from '@sutra/compliance';
import { env, sign, verify } from '@sutra/config';
import type { Actor, Contact, Id } from '@sutra/domain';
import { audit } from './audit.ts';
import {
  Companies,
  Consents,
  Contacts,
  Enrollments,
  Meetings,
  Messages,
  Replies,
  Suppressions,
  TrackingEvents,
  WorkspaceSettings,
} from './collections.ts';

const SYSTEM: Actor = { kind: 'system', id: 'compliance' };
/** Anonymised contacts get an address on this reserved domain, so nothing can reach them. */
export const ERASED_DOMAIN = 'erased.invalid';
const REDACTED = '[erased]';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Matches addresses at `domain` or any of its subdomains. */
const atDomain = (domain: string) => new RegExp(`[@.]${escapeRegex(domain)}$`, 'i');

async function load(workspaceId: Id, contactId: Id) {
  const contact = await Contacts.get(workspaceId, contactId);
  if (!contact) throw new Error(`Contact ${contactId} not found`);
  return contact;
}

/**
 * Gathers `check()`'s inputs for one contact and returns its decision. Pass `actor` for a real
 * send attempt so the decision is recorded in `audit_events`; leave it out for dry runs
 * (reports, the Prospects column).
 */
export async function checkFor(
  workspaceId: Id,
  contactId: Id,
  { at = new Date(), actor }: { at?: Date; actor?: Actor } = {},
): Promise<Decision> {
  const contact = await load(workspaceId, contactId);
  const [company, workspace] = await Promise.all([
    Companies.get(workspaceId, contact.companyId),
    WorkspaceSettings.findOne(workspaceId, {}),
  ]);
  if (!company || !workspace) throw new Error(`Company or workspace settings missing`);

  const domain = domainOf(contact.email);
  const domains = [...domainsOf(domain), ...(company.domain ? domainsOf(company.domain) : [])];
  const sent = (since: Date) => ({ direction: 'outbound' as const, sentAt: { $gt: since } });
  const sentAt = { projection: { sentAt: 1 } };
  const ms = at.getTime();
  const today = startOfDay(at, workspace.timezone);
  const [consents, suppressions, recent, domainRecent, mailboxSentToday, [first]] =
    await Promise.all([
      Consents.find(workspaceId, { contactId }),
      Suppressions.find(workspaceId, {
        $or: [
          { scope: 'email', value: contact.email },
          { scope: 'domain', value: { $in: domains } },
          { scope: 'email_hash', value: emailHash(contact.email) },
        ],
      }),
      Messages.find(workspaceId, { contactId, ...sent(new Date(ms - 7 * DAY)) }, sentAt),
      Messages.find(workspaceId, { to: atDomain(domain), ...sent(new Date(ms - DAY)) }, sentAt),
      Messages.count(workspaceId, { direction: 'outbound', sentAt: { $gte: today } }),
      Messages.find(
        workspaceId,
        { direction: 'outbound', sentAt: { $exists: true } },
        { ...sentAt, sort: { sentAt: 1 }, limit: 1 },
      ),
    ]);
  const sends = (list: { sentAt?: Date }[]) => list.map((m) => ({ at: m.sentAt as Date }));
  const firstDay = first ? startOfDay(first.sentAt as Date, workspace.timezone) : today;

  const decision = check({
    contact,
    company,
    at,
    workspace,
    consents,
    suppressions,
    recentSends: sends(recent),
    domainSends: sends(domainRecent),
    mailboxSentToday,
    mailboxDay: Math.round((today.getTime() - firstDay.getTime()) / DAY),
  });
  if (actor)
    await audit(workspaceId, actor, 'compliance.check', {
      entity: 'contact',
      entityId: contactId,
      data: {
        allow: decision.allow,
        pack: decision.pack,
        packVersion: decision.packVersion,
        ...(decision.allow
          ? { requirements: decision.requirements }
          : { reasons: decision.reasons.map((r) => r.code), retryAt: decision.retryAt }),
      },
    });
  return decision;
}

/** The hook signature agents and jobs receive, so tests can inject a fake. */
export type CheckFor = typeof checkFor;

export type OptOutSource = 'list_unsubscribe' | 'footer_link' | 'reply' | 'chat' | 'manual';

/** Stops every active or paused enrollment of these contacts. */
const stopEnrollments = (workspaceId: Id, ids: Id[], stopReason: 'opted_out' | 'manual') =>
  Enrollments.col().updateMany(
    { workspaceId, contactId: { $in: ids }, status: { $in: ['active', 'paused'] } },
    { $set: { status: 'stopped', stopReason, updatedAt: new Date() }, $unset: { nextRunAt: '' } },
  );

/**
 * The one opt-out handler: suppresses the address (or a whole domain), stops every enrollment,
 * cancels unsent messages and marks the contacts suppressed, then audits. Idempotent. Any send
 * already in flight is still refused by `checkFor()`, so nothing goes out after this returns.
 */
export async function optOut(
  workspaceId: Id,
  target: { email: string } | { domain: string },
  { source, evidence, actor = SYSTEM }: { source: OptOutSource; evidence: string; actor?: Actor },
) {
  const scope = 'email' in target ? 'email' : 'domain';
  const value = 'email' in target ? normalizeEmail(target.email) : target.domain.toLowerCase();
  const suppression = await Suppressions.upsertBy(workspaceId, 'value', {
    kind: source === 'chat' || source === 'manual' ? 'manual' : 'opt_out',
    scope,
    value,
    reason: `${source}: ${evidence}`,
    at: new Date(),
  });

  const companies = scope === 'domain' ? await Companies.find(workspaceId, { domain: value }) : [];
  const contacts = await Contacts.find(
    workspaceId,
    scope === 'email'
      ? { email: value }
      : { $or: [{ email: atDomain(value) }, { companyId: { $in: companies.map((c) => c._id) } }] },
    { projection: { _id: 1 } },
  );
  const ids = contacts.map((c) => c._id);
  const [enrollments, messages] = await Promise.all([
    stopEnrollments(workspaceId, ids, 'opted_out'),
    Messages.col().updateMany(
      {
        workspaceId,
        contactId: { $in: ids },
        direction: 'outbound',
        status: { $in: ['draft', 'queued', 'failed'] },
      },
      { $set: { status: 'cancelled', updatedAt: new Date() } },
    ),
    Contacts.col().updateMany(
      { workspaceId, _id: { $in: ids } },
      { $set: { status: 'suppressed', updatedAt: new Date() } },
    ),
  ]);
  const result = {
    suppressionId: suppression._id,
    contacts: ids.length,
    enrollmentsStopped: enrollments.modifiedCount,
    messagesCancelled: messages.modifiedCount,
  };
  await audit(workspaceId, actor, 'compliance.opt_out', {
    entity: 'suppression',
    entityId: suppression._id,
    data: { scope, source, ...result },
  });
  return result;
}

/** Signed, PII-free token naming one contact; used by the footer link and `List-Unsubscribe`. */
export const unsubscribeToken = (workspaceId: Id, contactId: Id) =>
  sign(`${workspaceId}:${contactId}`);

/** The footer link (`/u/…`, a confirm page) and the RFC 8058 one-click POST URL. */
export function unsubscribeLinks(workspaceId: Id, contactId: Id) {
  const token = unsubscribeToken(workspaceId, contactId);
  return { page: `${env.APP_URL}/u/${token}`, oneClick: `${env.APP_URL}/u/${token}/one-click` };
}

/** The contact and sender a token refers to, or `null` for a tampered or stale token. */
export async function unsubscribeTarget(token: string) {
  const [, workspaceId = '', contactId = ''] =
    verify(token)?.match(/^([a-f0-9]{24}):([a-f0-9]{24})$/) ?? [];
  const contact = contactId ? await Contacts.get(workspaceId, contactId) : null;
  if (!contact) return null;
  const settings = await WorkspaceSettings.findOne(workspaceId, {});
  return { workspaceId, contact, senderName: settings?.senderName ?? '' };
}

/** Handles both unsubscribe entry points. `false` means the token was invalid. */
export async function unsubscribe(token: string, source: 'list_unsubscribe' | 'footer_link') {
  const target = await unsubscribeTarget(token);
  if (!target) return false;
  await optOut(
    target.workspaceId,
    { email: target.contact.email },
    { source, evidence: `token for contact ${target.contact._id}` },
  );
  return true;
}

/** Everything Sutra stores about one person, for a data access request. */
export async function exportContact(workspaceId: Id, contactId: Id, actor: Actor) {
  const contact = await load(workspaceId, contactId);
  const by = { contactId };
  const [company, consents, enrollments, messages, replies, meetings, suppressions] =
    await Promise.all([
      Companies.get(workspaceId, contact.companyId),
      Consents.find(workspaceId, by),
      Enrollments.find(workspaceId, by),
      Messages.find(workspaceId, by),
      Replies.find(workspaceId, by),
      Meetings.find(workspaceId, by),
      Suppressions.find(workspaceId, {
        value: { $in: [contact.email, emailHash(contact.email)] },
      }),
    ]);
  const trackingEvents = await TrackingEvents.find(workspaceId, {
    messageId: { $in: messages.map((m) => m._id) },
  });
  await audit(workspaceId, actor, 'compliance.export', { entity: 'contact', entityId: contactId });
  return {
    exportedAt: new Date(),
    contact,
    company,
    consents,
    enrollments,
    messages,
    replies,
    meetings,
    trackingEvents,
    suppressions,
  };
}

/**
 * Removes a contact's personal data but keeps the record (for stats) and, when `suppress` is
 * set or they were already suppressed, an `email_hash` suppression so they're never re-contacted.
 */
async function anonymise(workspaceId: Id, contact: Contact, suppress: boolean) {
  const hash = emailHash(contact.email);
  const prior = await Suppressions.findOne(workspaceId, { scope: 'email', value: contact.email });
  if (suppress || prior || contact.status === 'suppressed') {
    await Suppressions.upsertBy(workspaceId, 'value', {
      kind: suppress ? 'erased' : (prior?.kind ?? 'opt_out'),
      scope: 'email_hash',
      value: hash,
      reason: 'Personal data erased; the hash keeps this person suppressed',
      at: new Date(),
    });
  }
  if (prior) await Suppressions.remove(workspaceId, prior._id);

  const byContact = { workspaceId, contactId: contact._id };
  const updatedAt = new Date();
  await Promise.all([
    Contacts.update(workspaceId, contact._id, {
      email: `${hash.slice(0, 24)}@${ERASED_DOMAIN}`,
      name: undefined,
      firstName: undefined,
      title: undefined,
      personaMatch: undefined,
      status: 'suppressed',
    }),
    Messages.col().updateMany(byContact, {
      $set: { subject: REDACTED, body: REDACTED, updatedAt },
      $unset: { to: '', from: '' },
    }),
    Replies.col().updateMany(byContact, {
      $set: { summaryEn: REDACTED, updatedAt },
      $unset: { suggestedReply: '', referral: '', proposedTimes: '' },
    }),
    Consents.col().deleteMany(byContact),
    stopEnrollments(workspaceId, [contact._id], 'manual'),
  ]);
}

/** A data erasure request: anonymise now and keep a suppression hash. */
export async function eraseContact(workspaceId: Id, contactId: Id, actor: Actor) {
  await anonymise(workspaceId, await load(workspaceId, contactId), true);
  await audit(workspaceId, actor, 'compliance.erase', { entity: 'contact', entityId: contactId });
}

/**
 * The retention task (run by the `maintenance` cron): anonymises prospects inactive for longer
 * than their country pack's `retentionDays`. Returns how many were anonymised.
 */
export async function retentionSweep(workspaceId: Id, now = new Date(), actor = SYSTEM) {
  const settings = await WorkspaceSettings.findOne(workspaceId, {});
  const overrides = settings?.complianceOverrides;
  const minDays = Math.min(
    ...[...Object.values(PACKS), DEFAULT].map((p) => packFor(p.country, overrides).retentionDays),
  );
  const candidates = await Contacts.find(workspaceId, {
    updatedAt: { $lt: new Date(now.getTime() - minDays * DAY) },
    email: { $not: atDomain(ERASED_DOMAIN) },
  });
  const companies = await Companies.find(workspaceId, {
    _id: { $in: [...new Set(candidates.map((c) => c.companyId))] },
  });
  const country = new Map(companies.map((c) => [c._id, c.country]));
  const stale = candidates.filter((c) =>
    isStale(c, packFor(country.get(c.companyId) ?? DEFAULT.country, overrides), now),
  );
  for (const c of stale) await anonymise(workspaceId, c, false);
  if (stale.length)
    await audit(workspaceId, actor, 'compliance.retention', {
      entity: 'contact',
      data: { anonymised: stale.length },
    });
  return stale.length;
}
