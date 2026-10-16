import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { defineProject } from 'vitest/config';

const example = parseEnv(readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'));

export default defineProject({
  test: {
    // Placeholder values for every required key; the setup file points Mongo at the test server.
    env: Object.fromEntries(Object.entries(example).filter(([, v]) => v)),
    globalSetup: ['./test/mongo.ts'],
    setupFiles: ['./test/setup.ts'],
    hookTimeout: 60_000,
    // One shared mongod serves every DB test file in parallel; give slow writes room under load.
    testTimeout: 30_000,
  },
  resolve: {
    alias: { 'server-only': fileURLToPath(new URL('./test/empty.ts', import.meta.url)) },
  },
});
