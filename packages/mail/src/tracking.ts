import { env, sign, verify } from '@sutra/config';
import { Messages, TrackingEvents } from '@sutra/db';
import type { Id, Message } from '@sutra/domain';

/**
 * Open pixel and click redirect. Tokens are HMAC-signed (`TRACKING_SECRET`) and carry only ids
 * and the destination URL, never an address or name.
 */

const ID = '[a-f0-9]{24}';
const OPEN = new RegExp(`^o:(${ID}):(${ID})$`);
const CLICK = new RegExp(`^c:(${ID}):(${ID}):(https?://.+)$`);

export const openToken = (workspaceId: Id, messageId: Id) => sign(`o:${workspaceId}:${messageId}`);
export const clickToken = (workspaceId: Id, messageId: Id, url: string) =>
  sign(`c:${workspaceId}:${messageId}:${url}`);

/** The pixel URL and the link rewriter for one outgoing message. */
export const trackingFor = (workspaceId: Id, messageId: Id) => ({
  pixel: `${env.APP_URL}/t/o/${openToken(workspaceId, messageId)}.gif`,
  click: (url: string) => `${env.APP_URL}/t/c/${clickToken(workspaceId, messageId, url)}`,
});

/** Opens or clicks this soon after sending are scanners or prefetchers, not people. */
export const MACHINE_WINDOW_MS = 10_000;
const PROXY_AGENTS =
  /GoogleImageProxy|ggpht\.com|YahooMailProxy|Barracuda|Mimecast|Proofpoint|bot\b|crawler|spider|HeadlessChrome|python-requests|curl\//i;
/** Apple Mail Privacy Protection fetches from 17.0.0.0/8. */
const PROXY_RANGES: [base: number, bits: number][] = [[17 << 24, 8]];

const ipv4 = (ip: string) => {
  const m = ip.replace(/^::ffff:/, '').match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).reduce((n, o) => n * 256 + Number(o), 0) : undefined;
};

export interface Hit {
  userAgent?: string | null;
  ip?: string | null;
  at?: Date;
}

/** Privacy proxy, security scanner or a too-fast hit: excluded from "human opens". */
export function isMachine(sentAt: Date | undefined, { userAgent, ip, at = new Date() }: Hit) {
  if (sentAt && at.getTime() - sentAt.getTime() < MACHINE_WINDOW_MS) return true;
  if (userAgent && PROXY_AGENTS.test(userAgent)) return true;
  const n = ip ? ipv4(ip) : undefined;
  return (
    n !== undefined &&
    PROXY_RANGES.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits))
  );
}

/** Records an open or click for a message. Shared by the routes and the fake simulator. */
export async function recordEvent(
  message: Message,
  kind: 'open' | 'click',
  hit: Hit & { url?: string },
) {
  const at = hit.at ?? new Date();
  return TrackingEvents.create(message.workspaceId, {
    messageId: message._id,
    variantId: message.variantId,
    kind,
    machine: isMachine(message.sentAt, { ...hit, at }),
    ...(hit.url && { url: hit.url }),
    at,
  });
}

const outbound = async (workspaceId: string, messageId: string) => {
  const message = await Messages.get(workspaceId, messageId);
  return message?.direction === 'outbound' ? message : null;
};

/** `false` (record nothing) for a tampered token or an unknown message. */
export async function recordOpen(token: string, hit: Hit = {}) {
  const [, ws = '', id = ''] = verify(token)?.match(OPEN) ?? [];
  const message = id ? await outbound(ws, id) : null;
  if (!message) return false;
  await recordEvent(message, 'open', hit);
  return true;
}

/** The destination to redirect to, or `null` (record nothing) for a tampered token. */
export async function recordClick(token: string, hit: Hit = {}) {
  const [, ws = '', id = '', url = ''] = verify(token)?.match(CLICK) ?? [];
  const message = id ? await outbound(ws, id) : null;
  if (!message || !URL.canParse(url)) return null;
  await recordEvent(message, 'click', { ...hit, url });
  return url;
}
