import { z } from 'zod';

/** A status machine as data: each status lists the statuses it may move to. */
export type TransitionTable<S extends string> = { readonly [K in S]: readonly S[] };

export const canTransition = <S extends string>(table: TransitionTable<S>, from: S, to: S) =>
  table[from].includes(to);

export const campaignStatus = z.enum([
  'draft',
  'pending_approval',
  'approved',
  'running',
  'paused',
  'done',
]);
export type CampaignStatus = z.infer<typeof campaignStatus>;
export const campaignTransitions = {
  draft: ['pending_approval'],
  pending_approval: ['approved', 'draft'],
  approved: ['running', 'pending_approval'],
  running: ['paused', 'done'],
  paused: ['running', 'done'],
  done: [],
} as const satisfies TransitionTable<CampaignStatus>;

export const variantStatus = z.enum([
  'draft',
  'pending_approval',
  'approved',
  'active',
  'paused',
  'rejected',
  'retired',
]);
export type VariantStatus = z.infer<typeof variantStatus>;
export const variantTransitions = {
  draft: ['pending_approval'],
  pending_approval: ['approved', 'rejected'],
  approved: ['active'],
  active: ['paused', 'retired'],
  paused: ['active', 'retired'],
  rejected: [],
  retired: [],
} as const satisfies TransitionTable<VariantStatus>;

export const enrollmentStatus = z.enum(['active', 'paused', 'stopped', 'completed']);
export type EnrollmentStatus = z.infer<typeof enrollmentStatus>;
export const enrollmentTransitions = {
  active: ['paused', 'stopped', 'completed'],
  paused: ['active', 'stopped'],
  stopped: [],
  completed: [],
} as const satisfies TransitionTable<EnrollmentStatus>;

/** Outbound: draft → queued → sent (→ bounced). Inbound messages are `received`. */
export const messageStatus = z.enum([
  'draft',
  'queued',
  'sent',
  'failed',
  'bounced',
  'cancelled',
  'received',
]);
export type MessageStatus = z.infer<typeof messageStatus>;
export const messageTransitions = {
  draft: ['queued', 'cancelled'],
  queued: ['sent', 'failed', 'cancelled'],
  failed: ['queued', 'cancelled'],
  sent: ['bounced'],
  bounced: [],
  cancelled: [],
  received: [],
} as const satisfies TransitionTable<MessageStatus>;

export const contactStatus = z.enum([
  'new',
  'excluded',
  'contacted',
  'engaged',
  'interested',
  'not_now',
  'not_interested',
  'meeting_booked',
  'suppressed',
]);
export type ContactStatus = z.infer<typeof contactStatus>;
export const contactTransitions = {
  new: ['excluded', 'contacted', 'suppressed'],
  excluded: ['new', 'suppressed'],
  contacted: ['engaged', 'interested', 'not_now', 'not_interested', 'meeting_booked', 'suppressed'],
  engaged: ['interested', 'not_now', 'not_interested', 'meeting_booked', 'suppressed'],
  interested: ['meeting_booked', 'not_now', 'not_interested', 'suppressed'],
  not_now: ['contacted', 'engaged', 'interested', 'not_interested', 'meeting_booked', 'suppressed'],
  not_interested: ['interested', 'suppressed'],
  meeting_booked: ['interested', 'not_interested', 'suppressed'],
  suppressed: [],
} as const satisfies TransitionTable<ContactStatus>;

export const profileStatus = z.enum(['draft', 'confirmed']);
export const companyStatus = z.enum(['new', 'enriched', 'scored', 'disqualified', 'excluded']);
export const pipelineRunStatus = z.enum(['running', 'waiting_human', 'done', 'failed']);
export const pipelineNodeStatus = z.enum([
  'queued',
  'running',
  'done',
  'failed',
  'waiting_human',
  'skipped',
]);
export type PipelineNodeStatus = z.infer<typeof pipelineNodeStatus>;
