import { env } from '@sutra/config';

/**
 * A minimal Gmail REST client over `fetch` (no `googleapis`): the five calls Sutra needs, with
 * access tokens refreshed from the user's stored refresh token.
 */

export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class GoogleApiError extends Error {
  override name = 'GoogleApiError';
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A received message, parsed to what reply sync needs. */
export interface InboundMail {
  id: string;
  threadId: string;
  labelIds: string[];
  /** Lower-cased header name → value. */
  headers: Record<string, string>;
  from: string;
  subject: string;
  text: string;
}

/** The mailbox transport. `gmailClient()` talks to Gmail; `fakeClient()` simulates it. */
export interface MailClient {
  profile(): Promise<{ emailAddress: string; historyId: string }>;
  /** Sends a raw RFC 5322 message, in `threadId` when it's a follow-up. */
  send(raw: Buffer, threadId?: string): Promise<{ id: string; threadId: string }>;
  watch(topicName: string): Promise<{ historyId: string; expiration: Date }>;
  /** Inbox messages added since `startHistoryId`, or `null` when the cursor is too old. */
  history(startHistoryId: string): Promise<{ historyId: string; messageIds: string[] } | null>;
  message(id: string): Promise<InboundMail>;
}

type Fetch = typeof fetch;
type Token = { value: string; expiresAt: number };
const tokens = new Map<string, Token>();

/** Exchanges a refresh token for an access token, cached (per `cacheKey`) until shortly before expiry. */
export async function accessToken(
  refreshToken: string,
  { cacheKey = refreshToken, fetch: f = fetch, now = Date.now() } = {},
): Promise<string> {
  const cached = tokens.get(cacheKey);
  if (cached && cached.expiresAt - 60_000 > now) return cached.value;
  const res = await f(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !body.access_token) {
    tokens.delete(cacheKey);
    // `invalid_grant`: the user revoked access or the token expired; they must reconnect.
    throw new GoogleApiError(res.status, `Token refresh failed: ${body.error ?? res.status}`);
  }
  tokens.set(cacheKey, {
    value: body.access_token,
    expiresAt: now + (body.expires_in ?? 0) * 1000,
  });
  return body.access_token;
}

const decode = (data = '') => Buffer.from(data, 'base64url').toString('utf8');

interface Part {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: Part[];
}

/** The first part of `mimeType`, depth-first. */
function find(part: Part, mimeType: string): Part | undefined {
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const hit = find(p, mimeType);
    if (hit) return hit;
  }
  return undefined;
}

const stripHtml = (html: string) =>
  html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();

/** Gmail `format=full` JSON → `InboundMail`. */
export function parseMessage(json: {
  id: string;
  threadId: string;
  labelIds?: string[];
  payload: Part;
}): InboundMail {
  const headers = Object.fromEntries(
    (json.payload.headers ?? []).map((h) => [h.name.toLowerCase(), h.value]),
  );
  const plain = find(json.payload, 'text/plain');
  const html = find(json.payload, 'text/html');
  return {
    id: json.id,
    threadId: json.threadId,
    labelIds: json.labelIds ?? [],
    headers,
    from: headers.from ?? '',
    subject: headers.subject ?? '',
    text: plain ? decode(plain.body?.data) : stripHtml(decode(html?.body?.data)),
  };
}

/** A Gmail client for the mailbox whose access token `token()` returns. */
export function gmailClient(token: () => Promise<string>, f: Fetch = fetch): MailClient {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await f(`${GMAIL_API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await token()}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (!res.ok)
      throw new GoogleApiError(res.status, `Gmail ${path.split('?')[0]}: ${await res.text()}`);
    return (await res.json()) as T;
  }
  const post = <T>(path: string, body: unknown) =>
    call<T>(path, { method: 'POST', body: JSON.stringify(body) });

  return {
    profile: () => call('/profile'),
    send: (raw, threadId) =>
      post('/messages/send', { raw: raw.toString('base64url'), ...(threadId && { threadId }) }),
    async watch(topicName) {
      const r = await post<{ historyId: string; expiration: string }>('/watch', {
        topicName,
        labelIds: ['INBOX'],
        labelFilterBehavior: 'include',
      });
      return { historyId: r.historyId, expiration: new Date(Number(r.expiration)) };
    },
    async history(startHistoryId) {
      const ids = new Set<string>();
      let historyId = startHistoryId;
      let pageToken: string | undefined;
      try {
        do {
          const q = new URLSearchParams({
            startHistoryId,
            historyTypes: 'messageAdded',
            labelId: 'INBOX',
            ...(pageToken && { pageToken }),
          });
          const page = await call<{
            historyId: string;
            nextPageToken?: string;
            history?: { messagesAdded?: { message: { id: string } }[] }[];
          }>(`/history?${q}`);
          for (const h of page.history ?? [])
            for (const m of h.messagesAdded ?? []) ids.add(m.message.id);
          historyId = page.historyId;
          pageToken = page.nextPageToken;
        } while (pageToken);
      } catch (error) {
        if (error instanceof GoogleApiError && error.status === 404) return null;
        throw error;
      }
      return { historyId, messageIds: [...ids] };
    },
    message: async (id) => parseMessage(await call(`/messages/${id}?format=full`)),
  };
}
