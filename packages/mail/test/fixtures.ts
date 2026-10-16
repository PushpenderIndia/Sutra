import {
  Campaigns,
  Companies,
  Consents,
  Contacts,
  Mailboxes,
  Messages,
  newId,
  variantHash,
  WorkspaceSettings,
} from '@sutra/db';
import type { Contact, Id, Mailbox } from '@sutra/domain';
import { fakeClient } from '../src/fake.ts';
import type { MailClient } from '../src/gmail.ts';

/** Tuesday 13 Oct 2026, 09:30 in Singapore. */
export const T0 = new Date('2026-10-13T01:30:00Z');
export const MINUTE = 60_000;
export const later = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);

export const BODY =
  'Hi Ana,\n\nWe print cups. See [our samples](https://pixelpress.example/samples).\n\nMei';

/** A workspace with a mailbox, an approved running campaign and `n` contacts on separate domains. */
export async function workspace(n = 1, warmup = {}) {
  const ws = newId();
  await WorkspaceSettings.create(ws, {
    senderName: 'Mei Tan',
    senderTitle: 'Partnerships Lead',
    physicalAddress: '1 Demo Street, Singapore 000001',
    homeCountry: 'SG',
    timezone: 'Asia/Singapore',
    businessHours: { start: '09:00', end: '18:00', days: [1, 2, 3, 4, 5] },
    warmup,
  });
  const mailbox = await Mailboxes.create(ws, {
    userId: 'fake',
    email: `mei.${ws}@pixelpress.example`,
    historyId: '100',
  });
  const variant = {
    id: newId(),
    status: 'active' as const,
    origin: 'initial' as const,
    dimension: 'subject' as const,
    hypothesis: 'h',
    subject: 'Packaging for {{company}}',
    body: BODY,
  };
  const campaign = await Campaigns.create(ws, {
    name: 'C',
    icpVersion: 1,
    status: 'running',
    steps: [{ delayDays: 0, variants: [{ ...variant, approvedHash: variantHash(variant) }] }],
  });
  const contacts: Contact[] = [];
  for (let i = 0; i < n; i++) {
    const company = await Companies.create(ws, {
      name: `Acme ${i}`,
      normalizedName: `acme ${i}`,
      domain: `acme${i}.example`,
      country: 'SG',
      sources: [{ source: 'search', ref: 'q', at: T0 }],
    });
    const contact = await Contacts.create(ws, {
      companyId: company._id,
      email: `ana@acme${i}.example`,
      emailConfidence: 'verified',
      locale: 'en',
      timezone: 'Asia/Singapore',
    });
    await Consents.create(ws, {
      contactId: contact._id,
      basis: 'legitimate_interest',
      source: 'public_page',
      evidence: `https://acme${i}.example/team`,
      at: T0,
    });
    contacts.push(contact);
  }
  const enrollmentIds = contacts.map(() => newId());
  /** Queues step `stepIndex` for contact `i`. */
  const queue = (i = 0, stepIndex = 0, extra: { body?: string; subject?: string } = {}) => {
    const contact = contacts[i] as (typeof contacts)[number];
    const enrollmentId = enrollmentIds[i] as Id;
    return Messages.create(ws, {
      contactId: contact._id,
      campaignId: campaign._id,
      enrollmentId,
      stepIndex,
      variantId: variant.id,
      direction: 'outbound',
      status: 'queued',
      to: contact.email,
      subject: extra.subject ?? 'Packaging for Acme',
      body: extra.body ?? BODY,
      idempotencyKey: `${enrollmentId}:${stepIndex}`,
    });
  };
  return { ws, mailbox, campaign, variant, contacts, contact: contacts[0], queue };
}

/** The fake transport without background simulation, recording every raw message sent. */
export function recorder(mailbox: Mailbox) {
  const sent: { raw: string; threadId?: string; id: string; thread: string }[] = [];
  const base = fakeClient(mailbox, { autoplay: false });
  const client: MailClient = {
    ...base,
    async send(raw, threadId) {
      const r = await base.send(raw, threadId);
      sent.push({ raw: raw.toString('utf8'), threadId, id: r.id, thread: r.threadId });
      return r;
    },
  };
  return { client, sent };
}

/** The header block of a raw message, unfolded, as name → value (lower-cased names). */
export function headersOf(raw: string) {
  const block = raw.split(/\r?\n\r?\n/)[0] ?? '';
  return Object.fromEntries(
    block
      .replace(/\r?\n[ \t]+/g, ' ')
      .split(/\r?\n/)
      .map((line) => {
        const i = line.indexOf(':');
        return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()];
      }),
  );
}
