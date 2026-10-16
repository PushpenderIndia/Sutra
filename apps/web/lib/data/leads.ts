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
import type { Id } from '@sutra/domain';
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
  const [companies, replies, enrollments, meetings, campaigns] = await Promise.all([
    Companies.find(
      workspaceId,
      { _id: { $in: [...new Set(contacts.map((c) => c.companyId))] } },
      { projection: { name: 1 } },
    ),
    Replies.find(workspaceId, inContacts, newestFirst),
    Enrollments.find(workspaceId, inContacts, { sort: { createdAt: -1 } }),
    Meetings.find(workspaceId, inContacts, { sort: { startsAt: 1 } }),
    Campaigns.find(workspaceId, {}, { projection: { steps: 1 } }),
  ]);
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
      updatedAt: c.updatedAt.toISOString(),
    };
  });
}
export type LeadRow = Awaited<ReturnType<typeof loadLeads>>[number];

/** One contact's email thread, oldest first, with the reply analysis for inbound messages. */
export async function loadThread(workspaceId: Id, contactId: Id) {
  const [messages, replies] = await Promise.all([
    Messages.find(
      workspaceId,
      { contactId, status: { $in: ['sent', 'received', 'bounced'] } },
      { sort: { createdAt: 1 } },
    ),
    Replies.find(workspaceId, { contactId }),
  ]);
  const analysis = new Map(replies.map((r) => [r.messageId, r]));
  return messages.map((m) => {
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
}
export type ThreadMessage = Awaited<ReturnType<typeof loadThread>>[number];
