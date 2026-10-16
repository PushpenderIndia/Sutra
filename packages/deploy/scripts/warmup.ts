import { env } from '@sutra/config';
import { healthTargets, warmup } from '../src/index.ts';

/**
 * `pnpm warmup` — hit each service's health endpoint so the Cloud Run instances are up before a
 * demo (min instances 0 means the first real request would otherwise cold-start). Exits non-zero
 * if any service never answered, so it can gate the pre-demo checklist.
 */
const targets = healthTargets(env.APP_URL, env.LITELLM_BASE_URL);
console.log(`Warming ${targets.length} service(s)…`);
const results = await warmup(targets);
for (const r of results) {
  const mark = r.ok ? '✓' : '✗';
  const detail = r.ok ? `${r.status}` : (r.error ?? 'failed');
  console.log(`${mark} ${r.name.padEnd(14)} ${r.url}  ${detail} (${r.attempts} attempt(s))`);
}
if (results.some((r) => !r.ok)) {
  console.error('Some services did not respond. Check the deploy before presenting.');
  process.exit(1);
}
console.log('All services warm.');
