import { closeDb, migrate, seedDemo } from '../src/index.ts';

if (!process.argv.includes('--demo')) {
  console.error('Usage: pnpm db:seed --demo   (resets the demo workspace)');
  process.exit(1);
}
try {
  await migrate();
  const result = await seedDemo();
  console.log(
    `Seeded demo workspace ${result.workspaceId}: ${result.companies} companies, ` +
      `${result.contacts} contacts, ${result.meetings} meetings`,
  );
} finally {
  await closeDb();
}
