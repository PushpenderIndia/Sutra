import 'server-only';
import { createCipher } from './crypto.ts';
import { loadSource } from './load.ts';
import { parse } from './parse.ts';
import { serverSchema } from './schema.ts';

/** Validated server env. Throws at import (i.e. boot) listing every missing or invalid key. */
export const env = parse(serverSchema, loadSource());
export type Env = typeof env;

/** AES-256-GCM for tenant secrets, keyed by `ENCRYPTION_KEY`. */
export const { encrypt, decrypt } = createCipher(env.ENCRYPTION_KEY);

export { EnvError } from './parse.ts';
