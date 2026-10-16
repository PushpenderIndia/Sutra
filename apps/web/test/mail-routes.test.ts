import { env } from '@sutra/config';
import { Messages, migrate, TrackingEvents } from '@sutra/db';
import { clickToken, deliver, openToken } from '@sutra/mail';
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as gmailWebhook } from '@/app/api/webhooks/gmail/route';
import { GET as click } from '@/app/t/c/[token]/route';
import { GET as pixel } from '@/app/t/o/[token]/route';
import { recorder, T0, workspace } from '../../../packages/mail/test/fixtures';

// The webhook verifies against Google's JWKS; tests sign with a local key instead.
const google = vi.hoisted(() => ({ keys: undefined as JWTVerifyGetKey | undefined }));
vi.mock('jose', async (original) => ({
  ...(await original<typeof import('jose')>()),
  createRemoteJWKSet: () =>
    ((...args: Parameters<JWTVerifyGetKey>) =>
      (google.keys as JWTVerifyGetKey)(...args)) as JWTVerifyGetKey,
}));

const params = (token: string) => ({ params: Promise.resolve({ token }) });
const SA = 'gmail-push@sutra.iam.gserviceaccount.com';
let sign: (claims?: Record<string, unknown>, audience?: string) => Promise<string>;

beforeAll(async () => {
  await migrate();
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  google.keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] });
  env.GMAIL_PUSH_SERVICE_ACCOUNT = SA;
  sign = (claims = {}, audience = `${env.APP_URL}/api/webhooks/gmail`) =>
    new SignJWT({ email: SA, email_verified: true, ...claims })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://accounts.google.com')
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
});

async function sentMessage() {
  const w = await workspace();
  const m = await w.queue();
  await deliver(w.ws, m._id, { now: T0, client: recorder(w.mailbox).client });
  return { ...w, message: m };
}

describe('tracking routes', () => {
  it('pixel returns a no-store GIF and records an open; a tampered token is a 404', async () => {
    const { ws, message } = await sentMessage();
    const token = openToken(ws, message._id);
    const res = await pixel(new Request(`http://x/t/o/${token}.gif`), params(`${token}.gif`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(
      Buffer.from(await res.arrayBuffer())
        .subarray(0, 6)
        .toString(),
    ).toBe('GIF89a');
    const bad = await pixel(
      new Request('http://x'),
      params(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}.gif`),
    );
    expect(bad.status).toBe(404);
    expect(await TrackingEvents.count(ws, { kind: 'open' })).toBe(1);
  });

  it('click 302s to the signed destination and records it; tampering is a 404', async () => {
    const { ws, message } = await sentMessage();
    const token = clickToken(ws, message._id, 'https://pixelpress.example/samples');
    const res = await click(new Request('http://x'), params(token));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://pixelpress.example/samples');
    // Swap the destination but keep the signature: rejected.
    const [, sig] = token.split('.');
    const forged = `${Buffer.from(`c:${ws}:${message._id}:https://evil.example`).toString('base64url')}.${sig}`;
    expect((await click(new Request('http://x'), params(forged))).status).toBe(404);
    expect(await TrackingEvents.find(ws, { kind: 'click' })).toMatchObject([
      { url: 'https://pixelpress.example/samples' },
    ]);
  });
});

describe('/api/webhooks/gmail', () => {
  const body = (emailAddress: string) =>
    JSON.stringify({
      message: {
        data: Buffer.from(JSON.stringify({ emailAddress, historyId: 1 })).toString('base64'),
        messageId: '1',
      },
      subscription: 'projects/p/subscriptions/gmail',
    });
  const call = (token?: string, payload = body('nobody@pixelpress.example')) =>
    gmailWebhook(
      new Request('http://internal/api/webhooks/gmail', {
        method: 'POST',
        body: payload,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    );

  it('rejects unsigned, mis-addressed and foreign requests', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('not-a-jwt')).status).toBe(401);
    expect((await call(await sign({}, 'https://other.example/'))).status).toBe(401);
    expect((await call(await sign({ email: 'evil@x.iam.gserviceaccount.com' }))).status).toBe(401);
  });

  it('accepts a Pub/Sub push signed by the configured service account', async () => {
    expect((await call(await sign())).status).toBe(204);
    expect((await call(await sign(), '{"message":{"data":"!!"}}')).status).toBe(400);
  });

  it('syncs the mailbox the notification names (fake transport: no new mail)', async () => {
    const { ws, mailbox } = await sentMessage();
    expect((await call(await sign(), body(mailbox.email))).status).toBe(204);
    expect(await Messages.count(ws, { direction: 'inbound' })).toBe(0);
  });
});
