import type { ContactStatus } from '@sutra/domain';

/** The Leads tab status cards, in display order. */
export const LEAD_BUCKETS = [
  'interested',
  'not_interested',
  'meeting_booked',
  'awaiting',
  'not_now',
] as const;
export type LeadBucket = (typeof LEAD_BUCKETS)[number];

const BUCKET: Partial<Record<ContactStatus, LeadBucket>> = {
  interested: 'interested',
  not_interested: 'not_interested',
  meeting_booked: 'meeting_booked',
  contacted: 'awaiting',
  engaged: 'awaiting',
  not_now: 'not_now',
};

/** The card a contact counts towards, if any (suppressed contacts are in no card). */
export const bucketOf = (status: ContactStatus): LeadBucket | undefined => BUCKET[status];

/** Statuses that make a contact a lead: everyone who has been contacted. */
export const LEAD_STATUSES = Object.keys(BUCKET).concat('suppressed') as ContactStatus[];

/** "Hot" order: interested and meetings first, then awaiting, then the rest. */
export const HOT_RANK: Record<LeadBucket, number> = {
  interested: 0,
  meeting_booked: 1,
  awaiting: 2,
  not_now: 3,
  not_interested: 4,
};
