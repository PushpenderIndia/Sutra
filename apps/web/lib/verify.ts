import 'server-only';
import { createSigner, env } from '@sutra/config';
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';

/**
 * Verifiers for the only unauthenticated endpoints: webhooks (`/api/webhooks/*`), jobs
 * (`/api/jobs/*`) and tracking links. Each route handler there must call one of these first.
 */

export class VerificationError extends Error {
  override name = 'VerificationError';
}

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/**
 * Verifies the Google-signed OIDC token that Pub/Sub push and Cloud Tasks attach as
 * `Authorization: Bearer …`: signature, issuer, audience (default: the request URL without
 * its query) and the sending service account. Callers behind Cloud Run's proxy (the job route, the
 * Gmail webhook) pass an explicit `audience` built from `APP_URL`, since the proxied request origin
 * is not the public URL the token was minted for.
 */
export async function verifyGoogleOidc(
  request: Request,
  opts: { serviceAccount: string; audience?: string; keys?: JWTVerifyGetKey },
) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new VerificationError('Missing bearer token');
  const url = new URL(request.url);
  const audience = opts.audience ?? `${url.origin}${url.pathname}`;
  try {
    const { payload } = await jwtVerify(token, opts.keys ?? googleKeys, {
      issuer: GOOGLE_ISSUERS,
      audience,
    });
    if (payload.email !== opts.serviceAccount || payload.email_verified !== true) {
      throw new VerificationError('Unexpected service account');
    }
    return payload;
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    throw new VerificationError(`Invalid OIDC token: ${(error as Error).message}`);
  }
}

/** A URL-safe `payload.signature` token (open/click/unsubscribe links), keyed by `TRACKING_SECRET`. */
export function signToken(data: Record<string, unknown>, secret = env.TRACKING_SECRET) {
  return createSigner(secret).sign(JSON.stringify(data));
}

/** The data inside a `signToken()` token. Throws on any tampering. */
export function verifyToken<T = Record<string, unknown>>(
  token: string,
  secret = env.TRACKING_SECRET,
): T {
  const payload = createSigner(secret).verify(token);
  if (payload === null) throw new VerificationError('Bad signature');
  return JSON.parse(payload) as T;
}
