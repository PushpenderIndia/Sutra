/**
 * The free-tier invariants the deploy must hold (todo/README.md section 5). These are the single
 * source of truth that `auditInfra()` checks the Terraform / Cloud Build / Docker files against, so
 * an edit that would quietly leave the always-free tiers fails a test instead of a bill.
 */
export const freeTier = {
  /** Cloud Run's always-free monthly usage only applies in these regions. */
  regions: ['us-central1', 'us-east1', 'us-west1'] as const,
  /** The default (and demo) region. */
  defaultRegion: 'us-central1',
  /** Both Cloud Run services scale to zero. */
  minInstances: 0,
  /** The one Secret Manager secret, a whole dotenv file. */
  secretName: 'SUTRA_ENV',
  /** Cloud Run mounts it here; @sutra/config reads /secrets/.env. */
  secretMountFile: '/secrets/.env',
  /** The one Cloud Scheduler job (the free tier allows 3). */
  schedulerJobs: ['maintenance'] as const,
  /** Artifact Registry keeps only the most recent image (0.5 GB free tier). */
  artifactKeepCount: 1,
  /** The Cloud Tasks queue name. */
  tasksQueue: 'sutra-jobs',
  /** The Pub/Sub topic Gmail push publishes to. */
  pubsubTopic: 'gmail-push',
  /** The budget alert backstop, in USD. */
  budgetUsd: 10,
  /** The two Cloud Run services. */
  services: ['sutra-web', 'sutra-litellm'] as const,
} as const;

export type Region = (typeof freeTier.regions)[number];
