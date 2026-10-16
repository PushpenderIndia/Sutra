import { emailHash } from '@sutra/compliance';
import type { Country, Id } from '@sutra/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AuditEvents,
  Companies,
  Consents,
  Contacts,
  Enrollments,
  Messages,
  Replies,
  Suppressions,
  WorkspaceSettings,
} from './collections.ts';
import {
  checkFor,
  ERASED_DOMAIN,
  eraseContact,
  exportContact,
  optOut,
  retentionSweep,
  unsubscribe,
  unsubscribeLinks,
  unsubscribeTarget,
  unsubscribeToken,
} from './compliance.ts';
import { migrate } from './migrate.ts';
import { newId } from './repository.ts';

const DAY = 86_400_000;
/** Tuesday 13 Oct 2026, 10:00 in Singapore. */
const at = new Date('2026-10-13T02:00:00Z');
const user = { kind: 'user' as const, id: 'u1' };
const campaignId = newId();

beforeAll(() => migrate());

/** A fresh workspace with one company and its contacts. */
async function workspace(country: Country = 'SG', emails = ['ana@acme.example']) {
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
    country,
    sources: [{ source: 'search', ref: 'q', at }],
  });
  const contacts = await Contacts.createMany(
    ws,
    emails.map((email) => ({
      companyId: company._id,
      email,
      emailConfidence: 'verified' as const,
      locale: 'en' as const,
      timezone: 'Asia/Singapore',
    })),
  );
  await Consents.createMany(
    ws,
    contacts.map((c) => ({
      contactId: c._id,
      basis: 'legitimate_interest' as const,
      source: 'public_page',
      evidence: 'https://acme.example/team',
      at,
    })),
  );
  return { ws, company, contacts, contact: contacts[0] as (typeof contacts)[number] };
}

let key = 0;
const send = (
  ws: Id,
  contactId: Id,
  to: string,
  sentAt: Date,
  status: 'sent' | 'queued' = 'sent',
) =>
  Messages.create(ws, {
    contactId,
    campaignId,
    direction: 'outbound',
    status,
    to,
    subject: 'Hello',
    body: 'Hi Ana',
    idempotencyKey: `k${key++}`,
    ...(status === 'sent' && { sentAt }),
  });

const codes = (d: Awaited<ReturnType<typeof checkFor>>) =>
  d.allow ? [] : d.reasons.map((r) => r.code);

describe('checkFor', () => {
  it('allows a business contact with recorded legitimate interest', async () => {
    const { ws, contact } = await workspace();
    expect(await checkFor(ws, contact._id, { at })).toMatchObject({ allow: true, pack: 'SG' });
  });

  it('loads recent, domain and mailbox sends from messages', async () => {
    const { ws, contacts } = await workspace('SG', [
      'ana@acme.example',
      'bo@acme.example',
      'cy@mail.acme.example',
    ]);
    const [ana, bo, cy] = contacts.map((c) => c._id) as [Id, Id, Id];
    const ago = (days: number) => new Date(at.getTime() - days * DAY);
    await send(ws, ana, 'ana@acme.example', ago(3));
    await send(ws, ana, 'ana@acme.example', ago(0.5));
    expect(codes(await checkFor(ws, ana, { at }))).toEqual(['contact_frequency_cap']);
    // SG allows 3 per domain per day; subdomains count too, and older sends roll off.
    await send(ws, bo, 'bo@acme.example', ago(0.25));
    await send(ws, cy, 'cy@mail.acme.example', ago(0.125));
    expect(codes(await checkFor(ws, bo, { at }))).toEqual(['domain_frequency_cap']);
  });

  it('applies the warm-up ramp from the first send', async () => {
    const { ws, contact } = await workspace('SG', ['ana@acme.example']);
    const other = newId();
    const earlyToday = new Date(at.getTime() - 60_000);
    for (let i = 0; i < 25; i++) await send(ws, other, `p${i}@x${i}.example`, earlyToday);
    // Day 1 of warm-up: 20 per day, so 25 sent today is over.
    expect(codes(await checkFor(ws, contact._id, { at }))).toEqual(['mailbox_daily_cap']);
    // A week later the ramp allows 55 and today's count is back to zero.
    expect((await checkFor(ws, contact._id, { at: new Date(at.getTime() + 7 * DAY) })).allow).toBe(
      true,
    );
  });

  it('records the decision when an actor attempts a send', async () => {
    const { ws, contact } = await workspace('VN');
    const d = await checkFor(ws, contact._id, { at, actor: user });
    expect(codes(d)).toEqual(['no_lawful_basis']);
    const [event] = await AuditEvents.find(ws, { action: 'compliance.check' });
    expect(event?.data).toMatchObject({ allow: false, pack: 'VN', reasons: ['no_lawful_basis'] });
    await checkFor(ws, contact._id, { at });
    expect(await AuditEvents.count(ws, { action: 'compliance.check' })).toBe(1);
  });

  it('throws for an unknown contact or missing settings', async () => {
    const { ws, contact } = await workspace();
    await expect(checkFor(ws, newId())).rejects.toThrow('not found');
    await WorkspaceSettings.col().deleteMany({ workspaceId: ws });
    await expect(checkFor(ws, contact._id)).rejects.toThrow('missing');
  });
});

describe('optOut', () => {
  it('suppresses, stops enrollments, cancels unsent mail and blocks the next job cycle', async () => {
    const { ws, contact } = await workspace();
    const enrollment = await Enrollments.create(ws, {
      contactId: contact._id,
      campaignId,
      stepIndex: 1,
      nextRunAt: at,
    });
    const queued = await send(ws, contact._id, contact.email, at, 'queued');

    const result = await optOut(
      ws,
      { email: 'ANA@acme.example' },
      { source: 'reply', evidence: 'reply 1' },
    );
    expect(result).toMatchObject({ contacts: 1, enrollmentsStopped: 1, messagesCancelled: 1 });
    expect(await Enrollments.get(ws, enrollment._id)).toMatchObject({
      status: 'stopped',
      stopReason: 'opted_out',
    });
    expect((await Enrollments.get(ws, enrollment._id))?.nextRunAt).toBeUndefined();
    expect((await Messages.get(ws, queued._id))?.status).toBe('cancelled');
    expect((await Contacts.get(ws, contact._id))?.status).toBe('suppressed');
    // The deliver job re-checks before sending: blocked.
    expect(codes(await checkFor(ws, contact._id, { at }))).toEqual(['suppressed', 'suppressed']);
    expect(await AuditEvents.count(ws, { action: 'compliance.opt_out' })).toBe(1);

    // Idempotent.
    await optOut(ws, { email: contact.email }, { source: 'footer_link', evidence: 'again' });
    expect(await Suppressions.count(ws)).toBe(1);
  });

  it('suppresses a whole domain from a chat command', async () => {
    const { ws, contacts } = await workspace('SG', [
      'ana@acme.example',
      'bo@mail.acme.example',
      'cy@acme-group.example',
    ]);
    const other = await workspace();
    const result = await optOut(
      ws,
      { domain: 'Acme.example' },
      { source: 'chat', evidence: 'never email anyone at acme.example', actor: user },
    );
    // All three: two by address, one by its company's domain.
    expect(result.contacts).toBe(3);
    expect(await Suppressions.findOne(ws, { scope: 'domain' })).toMatchObject({
      kind: 'manual',
      value: 'acme.example',
    });
    for (const c of contacts) expect((await Contacts.get(ws, c._id))?.status).toBe('suppressed');
    // Other workspaces are untouched.
    expect((await Contacts.get(other.ws, other.contact._id))?.status).toBe('new');
  });
});

describe('unsubscribe links', () => {
  it('unsubscribes with a valid token and rejects tampered ones', async () => {
    const { ws, contact } = await workspace();
    const token = unsubscribeToken(ws, contact._id);
    expect(token).not.toContain(contact.email);
    expect(unsubscribeLinks(ws, contact._id)).toEqual({
      page: `http://localhost:3000/u/${token}`,
      oneClick: `http://localhost:3000/u/${token}/one-click`,
    });
    expect(await unsubscribeTarget(token)).toMatchObject({
      workspaceId: ws,
      senderName: 'Mei Tan',
    });

    expect(await unsubscribe(`${token}x`, 'list_unsubscribe')).toBe(false);
    expect(await unsubscribe(unsubscribeToken(ws, newId()), 'list_unsubscribe')).toBe(false);
    expect(await Suppressions.count(ws)).toBe(0);

    expect(await unsubscribe(token, 'list_unsubscribe')).toBe(true);
    expect(await Suppressions.findOne(ws, { value: contact.email })).toMatchObject({
      kind: 'opt_out',
    });
  });
});

describe('export, erase and retention', () => {
  it('exports everything stored about a contact', async () => {
    const { ws, contact } = await workspace();
    await send(ws, contact._id, contact.email, at);
    const data = await exportContact(ws, contact._id, user);
    expect(data).toMatchObject({ contact: { email: contact.email }, company: { name: 'Acme' } });
    expect(data.messages).toHaveLength(1);
    expect(data.consents).toHaveLength(1);
    expect(await AuditEvents.count(ws, { action: 'compliance.export' })).toBe(1);
  });

  it('erases PII but keeps a hash so the person is never re-contacted', async () => {
    const { ws, company, contact } = await workspace();
    const m = await send(ws, contact._id, contact.email, at);
    await Replies.create(ws, {
      messageId: m._id,
      contactId: contact._id,
      intent: 'not_interested',
      sentiment: 'negative',
      language: 'en',
      summaryEn: 'Ana says no',
      suggestedReply: 'Thanks Ana',
      at,
    });
    await optOut(ws, { email: contact.email }, { source: 'reply', evidence: 'r' });
    await eraseContact(ws, contact._id, user);

    const erased = await Contacts.get(ws, contact._id);
    expect(erased?.email.endsWith(`@${ERASED_DOMAIN}`)).toBe(true);
    expect(erased?.status).toBe('suppressed');
    expect(await Messages.get(ws, m._id)).toMatchObject({ subject: '[erased]', body: '[erased]' });
    expect((await Messages.get(ws, m._id))?.to).toBeUndefined();
    expect((await Replies.findOne(ws, {}))?.suggestedReply).toBeUndefined();
    expect(await Consents.count(ws, { contactId: contact._id })).toBe(0);
    // The plaintext suppression is replaced by its hash.
    expect(await Suppressions.find(ws, {})).toMatchObject([
      { scope: 'email_hash', value: emailHash(contact.email), kind: 'erased' },
    ]);
    const all = JSON.stringify(await exportContact(ws, contact._id, user));
    expect(all).not.toContain('ana@acme.example');
    expect(all).not.toContain('Ana');

    // Rediscovered later as a new contact: still blocked.
    const again = await Contacts.create(ws, {
      companyId: company._id,
      email: contact.email,
      emailConfidence: 'pattern',
      locale: 'en',
      timezone: 'Asia/Singapore',
    });
    expect(codes(await checkFor(ws, again._id, { at }))).toEqual(['suppressed', 'no_lawful_basis']);
  });

  it('anonymises stale prospects by their country pack', async () => {
    const vn = await workspace('VN', ['linh@pho.example', 'tam@pho.example']);
    const sg = await workspace('SG', ['ana@acme.example']);
    const now = new Date();
    const old = new Date(now.getTime() - 200 * DAY);
    const age = (ws: Id) =>
      Contacts.col().updateMany({ workspaceId: ws }, { $set: { updatedAt: old } });
    await Promise.all([age(vn.ws), age(sg.ws)]);
    // An active conversation is kept however old.
    const [linh, tam] = vn.contacts as [(typeof vn.contacts)[number], (typeof vn.contacts)[number]];
    await Contacts.col().updateOne({ _id: tam._id }, { $set: { status: 'interested' } });

    expect(await retentionSweep(vn.ws, now)).toBe(1);
    expect((await Contacts.get(vn.ws, linh._id))?.email).toContain(ERASED_DOMAIN);
    expect((await Contacts.get(vn.ws, tam._id))?.email).toBe('tam@pho.example');
    // Retention isn't an opt-out: no suppression is created.
    expect(await Suppressions.count(vn.ws)).toBe(0);
    expect(await AuditEvents.count(vn.ws, { action: 'compliance.retention' })).toBe(1);
    // SG keeps prospects for 365 days; already-anonymised contacts are skipped.
    expect(await retentionSweep(sg.ws, now)).toBe(0);
    expect(await retentionSweep(vn.ws, now)).toBe(0);
  });
});
