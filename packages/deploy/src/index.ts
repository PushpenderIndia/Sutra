/**
 * `@sutra/deploy`: the deploy + demo-ops helpers (PR 19). Pure, offline-testable logic — the
 * `scripts/` wrappers add the I/O (env, gcloud, fetch). The free-tier invariants live in
 * `constraints.ts` and `auditInfra()` checks the committed infra files against them.
 */
export { auditInfra } from './audit.ts';
export { freeTier, type Region } from './constraints.ts';
export { buildSubmitArgs, type DeployOptions, isFreeRegion } from './deploy.ts';
export {
  healthTargets,
  type WarmupOptions,
  type WarmupResult,
  type WarmupTarget,
  warmup,
} from './warmup.ts';
