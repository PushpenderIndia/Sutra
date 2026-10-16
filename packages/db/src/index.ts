import 'server-only';

export { type ComplianceStatus, statusOf, summarize } from '@sutra/compliance';
export {
  type ApprovedVariant,
  type ApproveVariantResult,
  approveCampaign,
  approvedVariant,
  approveVariant,
  campaignHash,
  MAX_ACTIVE_ARMS,
  rejectVariant,
  retireVariant,
  variantHash,
} from './approval.ts';
export { audit } from './audit.ts';
export { closeDb, db, mongo } from './client.ts';
export * from './collections.ts';
export {
  type CheckFor,
  checkFor,
  ERASED_DOMAIN,
  eraseContact,
  exportContact,
  type OptOutSource,
  optOut,
  retentionSweep,
  unsubscribe,
  unsubscribeLinks,
  unsubscribeTarget,
  unsubscribeToken,
} from './compliance.ts';
export { InvalidTransitionError } from './errors.ts';
export { indexes } from './indexes.ts';
export { toMongoSchema } from './json-schema.ts';
export { migrate } from './migrate.ts';
export { type Input, newId, type Patch, type Repository, repository } from './repository.ts';
export { DEMO_WORKSPACE_ID, seedDemo } from './seed.ts';
export { metricsFor, variantMetrics } from './stats.ts';
