import { publicEnv } from '@sutra/config/next';
import { describe, expect, it } from 'vitest';

/**
 * No secret may reach the browser (PR 18: "no secrets in the client bundle"). The only env values Next
 * inlines into client code come from `publicEnv()` — this asserts that set is exactly the `NEXT_PUBLIC_*`
 * keys and never a server secret. The built bundle is additionally scanned in CI
 * (`scripts/check-client-bundle.mjs`).
 */

const SERVER_SECRETS = [
  'BETTER_AUTH_SECRET',
  'LITELLM_API_KEY',
  'GEMINI_API_KEY',
  'ENCRYPTION_KEY',
  'TRACKING_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'MONGODB_URI',
];

describe('client env exposure', () => {
  it('only exposes NEXT_PUBLIC_* keys', () => {
    for (const key of Object.keys(publicEnv())) expect(key.startsWith('NEXT_PUBLIC_')).toBe(true);
  });

  it('never exposes a server secret', () => {
    const keys = Object.keys(publicEnv());
    for (const secret of SERVER_SECRETS) expect(keys).not.toContain(secret);
  });
});
