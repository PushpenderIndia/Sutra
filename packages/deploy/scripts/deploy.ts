import { execFileSync } from 'node:child_process';
import { env } from '@sutra/config';
import { buildSubmitArgs } from '../src/index.ts';

/**
 * `pnpm deploy:prod` runs `secrets:check` → build → this. It submits Cloud Build (infra/cloudbuild.yaml),
 * which tests, builds both images, pushes them, deploys the two Cloud Run services and runs migrations
 * — one command, inside the free Cloud Build quota. The target project/region come from the one env.
 */
const args = buildSubmitArgs({ project: env.GCP_PROJECT_ID, region: env.GCP_REGION });
console.log(`+ gcloud ${args.join(' ')}`);
try {
  execFileSync('gcloud', args, { stdio: 'inherit' });
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
