import 'server-only';
import { createCipher, createSigner } from './crypto.ts';
import { loadSource } from './load.ts';
import { type EnvSource, parse } from './parse.ts';
import { serverSchema } from './schema.ts';

/**
 * `next build` imports server modules to collect route config, but runtime secrets are only
 * mounted at boot, so the build validates against each key's documented example instead.
 */
const buildPlaceholders = (): EnvSource =>
  process.env.NEXT_PHASE === 'phase-production-build'
    ? Object.fromEntries(
        Object.entries(serverSchema.shape).map(([key, field]) => [
          key,
          field.meta()?.example as string | undefined,
        ]),
      )
    : {};

/** Validated server env. Throws at import (i.e. boot) listing every missing or invalid key. */
export const env = parse(serverSchema, { ...buildPlaceholders(), ...loadSource() });
export type Env = typeof env;

/** AES-256-GCM for tenant secrets, keyed by `ENCRYPTION_KEY`. */
export const { encrypt, decrypt } = createCipher(env.ENCRYPTION_KEY);

/** HMAC-signed public link tokens, keyed by `TRACKING_SECRET`. */
export const { sign, verify } = createSigner(env.TRACKING_SECRET);

export { createSigner, type Signer } from './crypto.ts';
export { EnvError } from './parse.ts';
