import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineProject } from 'vitest/config';

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const example = parseEnv(readFileSync(path('../../.env.example'), 'utf8'));

export default defineProject({
  test: {
    env: Object.fromEntries(Object.entries(example).filter(([, v]) => v)),
    // Same in-memory Mongo (one database per file) as @sutra/db.
    globalSetup: ['../../packages/db/test/mongo.ts'],
    setupFiles: ['../../packages/db/test/setup.ts', './test/setup.ts'],
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@/': path('./'),
      'server-only': path('../../packages/db/test/empty.ts'),
    },
  },
});
