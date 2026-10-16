import { closeDb, migrate, repositories } from '../src/index.ts';

try {
  await migrate();
  console.log(`Migrated ${repositories.length} collections (validators + indexes)`);
} finally {
  await closeDb();
}
