import { describe, expect, it, vi } from 'vitest';
import {
  accessToken,
  GMAIL_API,
  GoogleApiError,
  gmailClient,
  parseMessage,
  TOKEN_URL,
} from './gmail.ts';

const json = (body: unknown, status = 200) => Response.json(body, { status });

describe('accessToken', () => {
  it('refreshes from the refresh token, caches until near expiry, then refreshes again', async () => {
    const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const params = new URLSearchParams(init?.body as URLSearchParams);
      expect(params.get('grant_type')).toBe('refresh_token');
      expect(params.get('refresh_token')).toBe('rt-1');
      expect(params.get('client_id')).toBe('replace-me.apps.googleusercontent.com');
      return json({ access_token: `at-${f.mock.calls.length}`, expires_in: 3600 });
    });
    const opts = { cacheKey: 'k1', fetch: f as typeof fetch, now: 0 };
    expect(await accessToken('rt-1', opts)).toBe('at-1');
    expect(await accessToken('rt-1', { ...opts, now: 3_000_000 })).toBe('at-1');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]?.[0]).toBe(TOKEN_URL);
    // Within a minute of expiry: refresh.
    expect(await accessToken('rt-1', { ...opts, now: 3_560_000 })).toBe('at-2');
  });

  it('throws GoogleApiError on a revoked token', async () => {
    const f = async () => json({ error: 'invalid_grant' }, 400);
    await expect(accessToken('rt-x', { cacheKey: 'k2', fetch: f as typeof fetch })).rejects.toThrow(
      new GoogleApiError(400, 'Token refresh failed: invalid_grant'),
    );
  });
});

describe('gmailClient', () => {
  it('sends base64url raw in the thread with a bearer token', async () => {
    const f = vi.fn(async () => json({ id: 'g1', threadId: 't1' }));
    const client = gmailClient(async () => 'at', f as typeof fetch);
    expect(await client.send(Buffer.from('raw?message'), 't1')).toEqual({
      id: 'g1',
      threadId: 't1',
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GMAIL_API}/messages/send`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer at');
    expect(JSON.parse(init.body as string)).toEqual({
      raw: Buffer.from('raw?message').toString('base64url'),
      threadId: 't1',
    });
  });

  it('pages through history and returns null for an expired cursor', async () => {
    const pages = [
      {
        historyId: '5',
        nextPageToken: 'p2',
        history: [{ messagesAdded: [{ message: { id: 'a' } }] }],
      },
      {
        historyId: '7',
        history: [{ messagesAdded: [{ message: { id: 'b' } }, { message: { id: 'a' } }] }],
      },
    ];
    const f = vi.fn(async () => json(pages[f.mock.calls.length - 1]));
    const client = gmailClient(async () => 'at', f as typeof fetch);
    expect(await client.history('3')).toEqual({ historyId: '7', messageIds: ['a', 'b'] });
    expect(String(f.mock.calls[1]?.[0 as never])).toContain('pageToken=p2');

    const gone = gmailClient(async () => 'at', (async () => json({}, 404)) as typeof fetch);
    expect(await gone.history('1')).toBeNull();
  });

  it('starts a watch on the inbox', async () => {
    const f = vi.fn(async () => json({ historyId: '9', expiration: '1760000000000' }));
    const client = gmailClient(async () => 'at', f as typeof fetch);
    expect(await client.watch('projects/p/topics/gmail')).toEqual({
      historyId: '9',
      expiration: new Date(1760000000000),
    });
  });
});

describe('parseMessage', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  it('reads headers and the text part (falling back to stripped HTML)', () => {
    const headers = [
      { name: 'From', value: 'Ana <ana@acme.example>' },
      { name: 'Subject', value: 'Re: Packaging' },
      { name: 'In-Reply-To', value: '<x@p.example>' },
    ];
    const plain = parseMessage({
      id: 'm',
      threadId: 't',
      labelIds: ['INBOX'],
      payload: {
        headers,
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64('Sounds good') } },
          { mimeType: 'text/html', body: { data: b64('<p>Sounds good</p>') } },
        ],
      },
    });
    expect(plain).toMatchObject({
      from: 'Ana <ana@acme.example>',
      subject: 'Re: Packaging',
      text: 'Sounds good',
    });
    expect(plain.headers['in-reply-to']).toBe('<x@p.example>');
    const html = parseMessage({
      id: 'm',
      threadId: 't',
      payload: { headers, mimeType: 'text/html', body: { data: b64('<p>Hi<br>there</p>') } },
    });
    expect(html.text).toBe('Hi\nthere');
  });
});
