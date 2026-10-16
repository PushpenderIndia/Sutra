import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCipher } from './crypto.ts';

const key = () => randomBytes(32).toString('base64');
const v1 = `v1:${key()}`;

describe('createCipher', () => {
  const { encrypt, decrypt } = createCipher(v1);

  it('round-trips, with a fresh IV per value', () => {
    for (const x of ['', 'ya29.refresh-token', 'unicode ✓ सूत्र'])
      expect(decrypt(encrypt(x))).toBe(x);
    expect(encrypt('same')).not.toBe(encrypt('same'));
    expect(encrypt('x')).toMatch(/^v1:/);
  });

  it('throws on tampered ciphertext', () => {
    const ciphertext = encrypt('secret');
    const [version, body = ''] = ciphertext.split(':');
    const bytes = Buffer.from(body, 'base64url');
    bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1;
    expect(() => decrypt(`${version}:${bytes.toString('base64url')}`)).toThrow();
    expect(() => decrypt(`${version}:AAAA`)).toThrow('Malformed');
  });

  it('throws on an unknown key version or the wrong key', () => {
    expect(() => decrypt(encrypt('x').replace(/^v1/, 'v9'))).toThrow(
      'Unknown encryption key version',
    );
    expect(() => createCipher(`v1:${key()}`).decrypt(encrypt('x'))).toThrow();
  });

  it('decrypts values from an older key after rotation', () => {
    const rotated = createCipher(`v2:${key()},${v1}`);
    expect(rotated.decrypt(encrypt('old'))).toBe('old');
    expect(rotated.encrypt('new')).toMatch(/^v2:/);
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => createCipher('v1:c2hvcnQ=')).toThrow('32 bytes');
  });
});
