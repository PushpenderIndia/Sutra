import { Mailboxes, migrate, newId, WorkspaceSettings } from '@sutra/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { FAKE_USER, MailboxError, mailboxFor } from './mailbox.ts';

beforeAll(() => migrate());

const base = {
  senderName: 'Mei Tan',
  homeCountry: 'SG',
  timezone: 'Asia/Singapore',
  businessHours: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
  warmup: {},
};

const settings = (ws: string, demoMode: boolean) =>
  WorkspaceSettings.create(ws, { ...base, demoMode });

describe('mailboxFor: demo vs live', () => {
  it('mints a synthetic fake mailbox in demo mode when none exists', async () => {
    const ws = newId();
    await settings(ws, true);
    const mailbox = await mailboxFor(ws);
    expect(mailbox.userId).toBe(FAKE_USER);
    expect(mailbox.email).toMatch(/@mailbox\.example$/);
  });

  it('defaults to demo when the workspace has no settings', async () => {
    const mailbox = await mailboxFor(newId());
    expect(mailbox.userId).toBe(FAKE_USER);
  });

  it('reuses the existing fake mailbox in demo mode', async () => {
    const ws = newId();
    const tag = ws.slice(-6);
    await settings(ws, true);
    const fake = await Mailboxes.create(ws, {
      userId: FAKE_USER,
      email: `demo-${tag}@mailbox.example`,
      historyId: '1',
    });
    const mailbox = await mailboxFor(ws);
    expect(mailbox._id).toBe(fake._id);
  });

  it('replaces a leftover real mailbox with the simulated one in demo mode', async () => {
    const ws = newId();
    const tag = ws.slice(-6);
    await settings(ws, true);
    const real = await Mailboxes.create(ws, {
      userId: `user-${tag}`,
      email: `real-${tag}@acme.example`,
      historyId: '9',
    });
    const mailbox = await mailboxFor(ws);
    expect(mailbox.userId).toBe(FAKE_USER);
    expect(mailbox.email).toMatch(/@mailbox\.example$/);
    // The one-per-workspace invariant holds: the real mailbox was swapped out.
    expect(await Mailboxes.get(ws, real._id)).toBeNull();
    expect(await Mailboxes.count(ws)).toBe(1);
  });

  it('returns the connected Gmail in live mode', async () => {
    const ws = newId();
    const tag = ws.slice(-6);
    await settings(ws, false);
    const real = await Mailboxes.create(ws, {
      userId: `user-${tag}`,
      email: `real-${tag}@acme.example`,
      historyId: '9',
    });
    const mailbox = await mailboxFor(ws);
    expect(mailbox._id).toBe(real._id);
    expect(mailbox.userId).toBe(`user-${tag}`);
  });

  it('throws in live mode when only a leftover fake mailbox exists', async () => {
    const ws = newId();
    const tag = ws.slice(-6);
    await settings(ws, false);
    await Mailboxes.create(ws, {
      userId: FAKE_USER,
      email: `demo-${tag}@mailbox.example`,
      historyId: '1',
    });
    await expect(mailboxFor(ws)).rejects.toBeInstanceOf(MailboxError);
  });

  it('throws in live mode when no mailbox exists', async () => {
    const ws = newId();
    await settings(ws, false);
    await expect(mailboxFor(ws)).rejects.toBeInstanceOf(MailboxError);
  });
});
