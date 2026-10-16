import { freeTier, type Region } from './constraints.ts';

export interface DeployOptions {
  project: string;
  region: string;
  /** Cloud Build config, relative to the repo root (default infra/cloudbuild.yaml). */
  config?: string;
  /** Source directory submitted to Cloud Build (default "."). */
  source?: string;
}

/** True if `region` is one of Cloud Run's always-free regions. */
export const isFreeRegion = (region: string): region is Region =>
  (freeTier.regions as readonly string[]).includes(region);

/**
 * The `gcloud builds submit` argv for a prod deploy. Pure, so the command is unit-tested; the
 * script just runs it. Submitting Cloud Build keeps the deploy to one command and $0 (the build
 * runs inside the free Cloud Build quota and deploys both Cloud Run services + migrations).
 */
export function buildSubmitArgs(opts: DeployOptions): string[] {
  if (!opts.project) throw new Error('GCP_PROJECT_ID is required to deploy');
  if (!isFreeRegion(opts.region))
    throw new Error(
      `region "${opts.region}" is not an always-free Cloud Run region (${freeTier.regions.join(', ')})`,
    );
  return [
    'builds',
    'submit',
    `--project=${opts.project}`,
    `--region=${opts.region}`,
    `--config=${opts.config ?? 'infra/cloudbuild.yaml'}`,
    `--substitutions=_REGION=${opts.region}`,
    opts.source ?? '.',
  ];
}
