import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freeTier } from './constraints.ts';

/**
 * Reads the committed infra files and returns every way they break a free-tier invariant. The
 * checks are intentionally textual (no Terraform binary in CI): each asserts that a specific knob
 * is set the way `freeTier` requires. `auditInfra()` returning `[]` is the deploy-config test.
 */
export function auditInfra(infraDir: string): string[] {
  const problems: string[] = [];
  const read = (rel: string): string | undefined => {
    const path = join(infraDir, rel);
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  };
  const require_ = (rel: string): string => {
    const content = read(rel);
    if (content === undefined) problems.push(`missing ${rel}`);
    return content ?? '';
  };

  const tfVars = require_('terraform/variables.tf');
  const tfMain = require_('terraform/main.tf');
  const cloudbuild = require_('cloudbuild.yaml');
  const webDocker = require_('docker/web.Dockerfile');
  const litellmDocker = require_('docker/litellm.Dockerfile');
  const litellmConfig = require_('litellm/config.yaml');

  // Region: default is us-central1 and the variable only allows the three always-free regions.
  if (!new RegExp(`default\\s*=\\s*"${freeTier.defaultRegion}"`).test(tfVars))
    problems.push(`terraform: region default must be "${freeTier.defaultRegion}"`);
  for (const region of freeTier.regions)
    if (!tfVars.includes(region)) problems.push(`terraform: region allowlist missing ${region}`);

  // Both Cloud Run services scale to zero, and there are exactly the two services.
  const minZero = tfMain.match(/min_instance_count\s*=\s*0/g) ?? [];
  if (minZero.length < freeTier.services.length)
    problems.push('terraform: every Cloud Run service needs min_instance_count = 0');
  for (const service of freeTier.services)
    if (!tfMain.includes(`"${service}"`)) problems.push(`terraform: missing service ${service}`);

  // LiteLLM has a public URL, so it must require its master key on every request.
  if (!/^\s*master_key:\s*os\.environ\/LITELLM_API_KEY\s*$/m.test(litellmConfig))
    problems.push(
      'litellm/config.yaml: sutra-litellm must set master_key: os.environ/LITELLM_API_KEY',
    );

  // Exactly one secret, mounted as a file.
  if (!new RegExp(`secret_id\\s*=\\s*"${freeTier.secretName}"`).test(tfMain))
    problems.push(`terraform: the one secret must be ${freeTier.secretName}`);

  // Artifact Registry keeps a single image.
  if (!new RegExp(`keep_count\\s*=\\s*${freeTier.artifactKeepCount}\\b`).test(tfMain))
    problems.push(`terraform: Artifact Registry must keep_count = ${freeTier.artifactKeepCount}`);

  // One scheduler job (within the 3-job free tier) and it is "maintenance".
  const schedulerJobs = tfMain.match(/resource\s+"google_cloud_scheduler_job"/g) ?? [];
  if (schedulerJobs.length !== freeTier.schedulerJobs.length)
    problems.push(`terraform: expected ${freeTier.schedulerJobs.length} Cloud Scheduler job(s)`);
  for (const job of freeTier.schedulerJobs)
    if (!new RegExp(`name\\s*=\\s*"${job}"`).test(tfMain))
      problems.push(`terraform: missing scheduler job ${job}`);

  // Cloud Tasks queue and Pub/Sub topic.
  if (!new RegExp(`name\\s*=\\s*"${freeTier.tasksQueue}"`).test(tfMain))
    problems.push(`terraform: missing Cloud Tasks queue ${freeTier.tasksQueue}`);
  if (!tfMain.includes(freeTier.pubsubTopic))
    problems.push(`terraform: missing Pub/Sub topic ${freeTier.pubsubTopic}`);

  // Budget guard present.
  if (!tfMain.includes('google_billing_budget'))
    problems.push('terraform: missing billing budget guard');

  // Cloud Build builds both images, deploys to the region and runs migrations.
  for (const service of freeTier.services)
    if (!cloudbuild.includes(service)) problems.push(`cloudbuild: does not deploy ${service}`);
  if (!/db:migrate|migrate/.test(cloudbuild)) problems.push('cloudbuild: missing db:migrate step');

  // Next.js standalone image and config.
  if (!webDocker.includes('standalone'))
    problems.push('web.Dockerfile: must use the Next.js standalone output');
  if (!litellmDocker.includes('config.yaml'))
    problems.push('litellm.Dockerfile: must bake in config.yaml');

  return problems;
}
