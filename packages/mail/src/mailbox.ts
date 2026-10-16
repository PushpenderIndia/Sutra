import { decrypt, env } from '@sutra/config';
import { audit, Credentials, Mailboxes, WorkspaceSettings } from '@sutra/db';
import type { Id, Mailbox } from '@sutra/domain';
import { fakeClient } from './fake.ts';
import { accessToken, gmailClient, type MailClient } from './gmail.ts';

export class MailboxError extends Error {
  override name = 'MailboxError';
}

export const FAKE_USER = 'fake';

/** The user's Google refresh token for a workspace (stored encrypted in `credentials`). */
export async function googleRefreshToken(workspaceId: Id, userId: string) {
  const credential = await Credentials.findOne(workspaceId, { provider: 'google', userId });
  return credential && decrypt(credential.ciphertext);
}

/** The transport for a mailbox: the simulator in `FAKE_MAIL` mode, Gmail otherwise. */
export function clientFor(mailbox: Mailbox): MailClient {
  if (env.FAKE_MAIL || mailbox.userId === FAKE_USER) return fakeClient(mailbox);
  return gmailClient(async () => {
    const refreshToken = await googleRefreshToken(mailbox.workspaceId, mailbox.userId);
    if (!refreshToken) throw new MailboxError('Mailbox disconnected: connect it again');
    return accessToken(refreshToken, { cacheKey: `${mailbox.workspaceId}:${mailbox.userId}` });
  });
}

/** Full Pub/Sub topic name, from `GMAIL_PUBSUB_TOPIC` (short or `projects/…/topics/…`). */
export const pubsubTopic = (topic = env.GMAIL_PUBSUB_TOPIC) =>
  topic &&
  (topic.startsWith('projects/') ? topic : `projects/${env.GCP_PROJECT_ID}/topics/${topic}`);

/** (Re)starts Gmail push for a mailbox. Watches last 7 days; the `maintenance` cron renews them. */
export async function startWatch(mailbox: Mailbox, client = clientFor(mailbox)) {
  const topic = pubsubTopic();
  if (!topic) return mailbox;
  const { historyId, expiration } = await client.watch(topic);
  return (
    (await Mailboxes.update(mailbox.workspaceId, mailbox._id, {
      historyId: mailbox.historyId ?? historyId,
      watchExpiresAt: expiration,
    })) ?? mailbox
  );
}

/** Renews every watch expiring within two days. For the `maintenance` cron. */
export async function renewWatches(now = new Date()) {
  const soon = new Date(now.getTime() + 2 * 86_400_000);
  const due = await Mailboxes.col()
    .find({ $or: [{ watchExpiresAt: { $exists: false } }, { watchExpiresAt: { $lt: soon } }] })
    .toArray();
  const results = await Promise.allSettled(due.map((m) => startWatch(m)));
  return results.filter((r) => r.status === 'fulfilled').length;
}

/**
 * Makes the user's Gmail the workspace's sending mailbox (called after "Connect mailbox"):
 * reads the address and history cursor, replaces any previous mailbox, and starts push.
 */
export async function connectMailbox(workspaceId: Id, userId: string, client?: MailClient) {
  const pending = { workspaceId, userId } as Mailbox;
  const { emailAddress, historyId } = await (client ?? clientFor(pending)).profile();
  const email = emailAddress.toLowerCase();
  await Mailboxes.col().deleteMany({ $or: [{ workspaceId }, { email }] });
  const mailbox = await Mailboxes.create(workspaceId, { userId, email, historyId });
  await audit(workspaceId, { kind: 'user', id: userId }, 'mail.connect', {
    entity: 'mailbox',
    entityId: mailbox._id,
  });
  return startWatch(mailbox, client);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');

/** The workspace's sending mailbox. In `FAKE_MAIL` mode one is created on first use. */
export async function mailboxFor(workspaceId: Id): Promise<Mailbox> {
  const mailbox = await Mailboxes.findOne(workspaceId, {});
  if (mailbox) return mailbox;
  if (!env.FAKE_MAIL) throw new MailboxError('No mailbox connected: connect Gmail in Settings');
  const settings = await WorkspaceSettings.findOne(workspaceId, {});
  const email = `${slug(settings?.senderName ?? '') || 'sender'}.${workspaceId.slice(-6)}@mailbox.example`;
  return Mailboxes.upsertBy(workspaceId, 'email', { userId: FAKE_USER, email, historyId: '1' });
}
