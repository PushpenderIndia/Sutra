import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import type { EnvSource } from './parse.ts';

/** Where Cloud Run mounts the `SUTRA_ENV` secret. */
export const MOUNTED_ENV_FILE = '/secrets/.env';

const readEnvFile = (path: string): EnvSource =>
  existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};

/** Nearest ancestor of `from` containing `pnpm-workspace.yaml`, if any. */
export function findRepoRoot(from = process.cwd()): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** Repo-root `.env.local` (local dev). */
export const localEnvFile = (root = findRepoRoot()) =>
  root ? join(root, '.env.local') : undefined;

/**
 * Raw env, lowest to highest precedence: repo-root `.env.local` (local dev),
 * `process.env`, then the mounted secret file (`SUTRA_ENV_FILE`, default `/secrets/.env`).
 */
export function loadSource(env: EnvSource = process.env): EnvSource {
  const local = localEnvFile();
  return {
    ...(local ? readEnvFile(local) : {}),
    ...env,
    ...readEnvFile(env.SUTRA_ENV_FILE ?? MOUNTED_ENV_FILE),
  };
}
