import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface Cipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/**
 * AES-256-GCM over a keyring `"v2:<base64>,v1:<base64>"`. The first key encrypts; any key
 * decrypts. Output is `<version>:<base64url(iv | tag | ciphertext)>`, so values encrypted with
 * an older key stay readable after a new one is prepended.
 */
export function createCipher(keyring: string): Cipher {
  const keys = new Map(
    keyring.split(',').map((entry) => {
      const [version = '', key = ''] = entry.split(':');
      const bytes = Buffer.from(key, 'base64');
      if (bytes.length !== 32) throw new Error(`Encryption key ${version} must be 32 bytes`);
      return [version, bytes] as const;
    }),
  );
  const [current, currentKey] = [...keys][0] ?? [];
  if (!current || !currentKey) throw new Error('Encryption keyring is empty');

  return {
    encrypt(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, currentKey, iv);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const payload = Buffer.concat([iv, cipher.getAuthTag(), body]);
      return `${current}:${payload.toString('base64url')}`;
    },
    decrypt(ciphertext) {
      const sep = ciphertext.indexOf(':');
      const key = keys.get(ciphertext.slice(0, sep));
      if (sep < 0 || !key) throw new Error('Unknown encryption key version');
      const payload = Buffer.from(ciphertext.slice(sep + 1), 'base64url');
      if (payload.length < IV_BYTES + TAG_BYTES) throw new Error('Malformed ciphertext');
      const decipher = createDecipheriv(ALGORITHM, key, payload.subarray(0, IV_BYTES));
      decipher.setAuthTag(payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([
        decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

export interface Signer {
  /** `base64url(payload).base64url(hmac)`: URL-safe, tamper-evident, not secret. */
  sign(payload: string): string;
  /** The payload, or `null` if the token was tampered with or signed with another secret. */
  verify(token: string): string | null;
}

/** HMAC-SHA256 tokens for public links (unsubscribe, tracking). */
export function createSigner(secret: string): Signer {
  const mac = (body: string) => createHmac('sha256', secret).update(body).digest('base64url');
  return {
    sign(payload) {
      const body = Buffer.from(payload, 'utf8').toString('base64url');
      return `${body}.${mac(body)}`;
    },
    verify(token) {
      const [body = '', sig = '', ...rest] = token.split('.');
      const given = Buffer.from(sig);
      const expected = Buffer.from(mac(body));
      const valid =
        !rest.length && given.length === expected.length && timingSafeEqual(given, expected);
      return valid ? Buffer.from(body, 'base64url').toString('utf8') : null;
    },
  };
}
