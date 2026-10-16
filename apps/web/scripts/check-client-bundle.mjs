// CI guard (PR 18): fail the build if any real server secret value appears in the client bundle.
// Scans the browser-served output (`.next/static`) for the literal values of known secret env vars.
// Placeholder/short values (dev, CI) are skipped, so this only fires on a genuine leak.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, '.next', 'static');

const SECRET_VARS = [
  'BETTER_AUTH_SECRET',
  'LITELLM_API_KEY',
  'GEMINI_API_KEY',
  'ENCRYPTION_KEY',
  'TRACKING_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'MONGODB_URI',
];

/** A value worth searching for: present, long enough to be a real secret, not an obvious placeholder. */
const realSecret = (value) =>
  typeof value === 'string' &&
  value.length >= 16 &&
  !/replace-me|localhost|example|changeme|your-/i.test(value);

// biome-ignore lint/style/noProcessEnv: standalone CI scanner (not app code) reads the real secret values to grep the built bundle for them
const secrets = SECRET_VARS.map((name) => [name, process.env[name]]).filter(([, v]) =>
  realSecret(v),
);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(js|mjs|css|map|json|txt|html)$/.test(entry)) yield full;
  }
}

if (secrets.length === 0) {
  console.log(
    'check-client-bundle: no real secrets in env to scan for (placeholders skipped) — ok',
  );
  process.exit(0);
}

const leaks = [];
for (const file of walk(staticDir)) {
  const content = readFileSync(file, 'utf8');
  for (const [name, value] of secrets) if (content.includes(value)) leaks.push({ name, file });
}

if (leaks.length) {
  console.error('check-client-bundle: SECRET LEAK in client bundle:');
  for (const { name, file } of leaks) console.error(`  - ${name} found in ${file}`);
  process.exit(1);
}
console.log(
  `check-client-bundle: scanned ${staticDir} for ${secrets.length} secret(s) — none leaked`,
);
