/**
 * `@sutra/compliance`: the one gate every email passes. Country rules are data (`packs/`);
 * `check()` is a pure function over them. Rules are product defaults, not legal advice.
 */
export { AU, DEFAULT, ID, IN, JP, MY, PACKS, PH, SG, TH, VN } from '../packs/index.ts';
export { domainOf, domainsOf, emailHash, isPersonalEmail, normalizeEmail } from './address.ts';
export {
  type AllowDecision,
  type BlockDecision,
  type CheckInput,
  check,
  type Decision,
  mailboxCap,
  packFor,
  type Reason,
  type ReasonCode,
  type Requirement,
} from './check.ts';
export {
  type Need,
  type Pack,
  type PackOverride,
  pack,
  packOverride,
  type SendWindow,
  tighten,
} from './pack.ts';
export { type ComplianceStatus, isStale, REASON_LABELS, statusOf, summarize } from './report.ts';
export { DAY, local, nextMidnight, nextOpen, startOfDay, zoned } from './time.ts';
