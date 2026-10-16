import { afterAll, beforeAll, inject, vi } from 'vitest';

// Each test file gets its own database on the shared in-memory server.
vi.stubEnv('MONGODB_URI', inject('mongoUri'));
vi.stubEnv('MONGODB_DB', `test_${crypto.randomUUID().slice(0, 8)}`);

const { closeDb, db } = await import('../src/client.ts');
beforeAll(async () => {
  await db().dropDatabase();
});
afterAll(async () => {
  await db().dropDatabase();
  await closeDb();
});
