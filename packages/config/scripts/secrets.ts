import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot, loadSource, localEnvFile } from '../src/load.ts';
import { check, envExample, gcloud, pull, push, writeSecretFile } from '../src/secrets.ts';

const root = findRepoRoot();
const localFile = localEnvFile(root);
if (!root || !localFile) throw new Error('Run from inside the Sutra repo');
const project = loadSource().GCP_PROJECT_ID;

const commands: Record<string, () => string> = {
  example() {
    writeFileSync(join(root, '.env.example'), envExample());
    return 'Wrote .env.example';
  },
  pull() {
    writeSecretFile(localFile, pull(gcloud, project));
    return 'Wrote .env.local from SUTRA_ENV';
  },
  push() {
    return `SUTRA_ENV is now at version ${push(gcloud, localFile, project)} (older versions destroyed)`;
  },
  check() {
    check(loadSource());
    return 'Environment OK';
  },
};

const command = commands[process.argv[2] ?? ''];
if (!command) {
  console.error(`Usage: secrets <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
try {
  console.log(command());
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
