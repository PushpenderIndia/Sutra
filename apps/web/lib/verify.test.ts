import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { signToken, VerificationError, verifyGoogleOidc, verifyToken } from './verify';

describe('signed tokens', () => {
  it('round-trips and rejects tampering', () => {
    const token = signToken({ m: 'abc', u: 'https://example.com' });
    expect(verifyToken(token)).toEqual({ m: 'abc', u: 'https://example.com' });
    const [payload] = token.split('.');
    const forged = `${Buffer.from('{"m":"evil"}').toString('base64url')}.${token.split('.')[1]}`;
    expect(() => verifyToken(forged)).toThrow(VerificationError);
    expect(() => verifyToken(`${payload}.`)).toThrow(VerificationError);
    expect(() => verifyToken(token, 'another-secret-another-secret-123')).toThrow(
      VerificationError,
    );
  });
});

describe('verifyGoogleOidc', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] });
  const serviceAccount = 'tasks@sutra.iam.gserviceaccount.com';
  const url = 'https://sutra.example/api/jobs/send?attempt=1';
  const jwt = (claims: Record<string, unknown>, audience = 'https://sutra.example/api/jobs/send') =>
    new SignJWT({ email: serviceAccount, email_verified: true, ...claims })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://accounts.google.com')
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  const call = async (token?: string) =>
    verifyGoogleOidc(
      new Request(url, { headers: token ? { authorization: `Bearer ${token}` } : {} }),
      { serviceAccount, keys },
    );

  it('accepts a Google-signed token for this endpoint and service account', async () => {
    expect(await call(await jwt({}))).toMatchObject({ email: serviceAccount });
  });

  it('rejects missing, mis-addressed or foreign tokens', async () => {
    await expect(call()).rejects.toThrow('Missing bearer token');
    await expect(call(await jwt({}, 'https://other.example/'))).rejects.toThrow(VerificationError);
    await expect(call(await jwt({ email: 'evil@x.com' }))).rejects.toThrow('service account');
  });
});
