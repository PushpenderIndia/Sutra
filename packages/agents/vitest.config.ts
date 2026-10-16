import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineProject } from 'vitest/config';

const example = parseEnv(readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'));
const db = (path: string) => fileURLToPath(new URL(`../db/test/${path}`, import.meta.url));

// Shares @sutra/db's in-memory MongoDB setup: one server per run, one database per file.
export default defineProject({
  test: {
    env: {
      ...Object.fromEntries(Object.entries(example).filter(([, v]) => v)),
      LLM_RPM_LIMITS: 'sutra-fast=10000,sutra-smart=10000',
    },
    globalSetup: [db('mongo.ts')],
    setupFiles: [db('setup.ts')],
    hookTimeout: 60_000,
  },
  resolve: { alias: { 'server-only': db('empty.ts') } },
});
