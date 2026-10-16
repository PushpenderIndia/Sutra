import 'server-only';
import {
  Campaigns,
  Companies,
  Contacts,
  Enrollments,
  Meetings,
  Messages,
  Replies,
} from '@sutra/db';
import type { Id, Locale, ReplyIntent } from '@sutra/domain';
import { variantLetter } from '@/lib/data/campaigns';
import { bucketOf, LEAD_STATUSES } from '@/lib/leads';

const newestFirst = { sort: { at: -1 } } as const;

/** Everyone contacted, with their latest reply, sequence position and meeting. */
export async function loadLeads(workspaceId: Id) {
  const contacts = await Contacts.find(
    workspaceId,
    { status: { $in: LEAD_STATUSES } },
    { sort: { updatedAt: -1 } },
  );
  const ids = contacts.map((c) => c._id);
  const inContacts = { contactId: { $in: ids } };
  const [companies, replies, enrollments, meetings, campaigns, drafts] = await Promise.all([
    Companies.find(
      workspaceId,
      { _id: { $in: [...new Set(contacts.map((c) => c.companyId))] } },
      { projection: { name: 1 } },
    ),
    Replies.find(workspaceId, inContacts, newestFirst),
    Enrollments.find(workspaceId, inContacts, { sort: { createdAt: -1 } }),
    Meetings.find(workspaceId, inContacts, { sort: { startsAt: 1 } }),
    Campaigns.find(workspaceId, {}, { projection: { steps: 1 } }),
    Messages.find(
      workspaceId,
      { ...inContacts, direction: 'outbound', status: 'draft' },
      { projection: { contactId: 1 } },
    ),
  ]);
  const hasDraft = new Set(drafts.map((d) => d.contactId));
  const first = <T extends { contactId: Id }>(docs: T[]) => {
    const map = new Map<Id, T>();
    for (const d of docs) if (!map.has(d.contactId)) map.set(d.contactId, d);
    return map;
  };
  const company = new Map(companies.map((c) => [c._id, c.name]));
  const reply = first(replies);
  const enrollment = first(enrollments);
  const meeting = first(meetings);
  const letter = new Map(
    campaigns.flatMap((c) => c.steps.flatMap((s) => s.variants.map((v, i) => [v.id, i] as const))),
  );

  return contacts.map((c) => {
    const r = reply.get(c._id);
    const e = enrollment.get(c._id);
    const step = r?.stepIndex ?? e?.stepIndex;
    const variantId = r?.variantId ?? (step === undefined ? undefined : e?.assignedVariants[step]);
    const index = variantId === undefined ? undefined : letter.get(variantId);
    return {
      id: c._id,
      name: c.name ?? c.email,
      email: c.email,
      title: c.title,
      company: company.get(c.companyId) ?? '',
      locale: c.locale,
      status: c.status,
      bucket: bucketOf(c.status),
      intent: r?.intent,
      summary: r?.summaryEn,
      repliedAt: r?.at.toISOString(),
      step: step === undefined ? undefined : step + 1,
      variant: index === undefined ? undefined : variantLetter(index),
      meetingAt: meeting.get(c._id)?.startsAt.toISOString(),
      hasDraft: hasDraft.has(c._id),
      updatedAt: c.updatedAt.toISOString(),
    };
  });
}
export type LeadRow = Awaited<ReturnType<typeof loadLeads>>[number];

/** One email in a lead's thread, with the reply analysis for inbound messages. */
export interface ThreadMessage {
  id: Id;
  direction: 'inbound' | 'outbound';
  subject: string;
  body: string;
  at: string;
  analysis?: { intent: ReplyIntent; summary: string; language: Locale };
}

/**
 * A lead's full conversation for the side sheet: the sent/received thread (with per-reply analysis),
 * the drafted reply awaiting approval, and the booked meeting — plus whether a meeting can be booked.
 */
export async function loadThread(workspaceId: Id, contactId: Id) {
  const [contact, messages, replies, draft, meeting] = await Promise.all([
    Contacts.get(workspaceId, contactId),
    Messages.find(
      workspaceId,
      { contactId, status: { $in: ['sent', 'received', 'bounced'] } },
      { sort: { createdAt: 1 } },
    ),
    Replies.find(workspaceId, { contactId }),
    Messages.findOne(workspaceId, { contactId, direction: 'outbound', status: 'draft' }),
    Meetings.findOne(workspaceId, { contactId }),
  ]);
  const analysis = new Map(replies.map((r) => [r.messageId, r]));
  const thread: ThreadMessage[] = messages.map((m) => {
    const a = analysis.get(m._id);
    return {
      id: m._id,
      direction: m.direction,
      subject: m.subject,
      body: m.body,
      at: (m.sentAt ?? m.createdAt).toISOString(),
      analysis: a && { intent: a.intent, summary: a.summaryEn, language: a.language },
    };
  });
  const canBook = !meeting && (contact?.status === 'interested' || contact?.status === 'engaged');
  return {
    messages: thread,
    draft: draft && { id: draft._id, subject: draft.subject, body: draft.body },
    meeting: meeting && {
      startsAt: meeting.startsAt.toISOString(),
      meetUrl: meeting.meetUrl,
      timezone: meeting.timezone,
    },
    canBook,
  };
}
export type LeadThread = Awaited<ReturnType<typeof loadThread>>;
