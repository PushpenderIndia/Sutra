import { closeDb, migrate, seedDemo } from '../src/index.ts';

if (!process.argv.includes('--demo')) {
  console.error(
    'Usage: pnpm db:seed --demo [--owner=you@example.com]   (resets the demo workspace)',
  );
  process.exit(1);
}
try {
  await migrate();
  const ownerEmail = process.argv.find((a) => a.startsWith('--owner='))?.slice('--owner='.length);
  const result = await seedDemo({ ownerEmail });
  console.log(
    `Seeded demo workspace ${result.workspaceId}: ${result.companies} companies, ` +
      `${result.contacts} contacts, ${result.meetings} meetings` +
      (result.owner ? `; owner ${result.owner}` : ''),
  );
} finally {
  await closeDb();
}
