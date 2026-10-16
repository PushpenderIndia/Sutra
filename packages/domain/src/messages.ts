import { z } from 'zod';
import { count, doc, id, locale, timezone } from './common.ts';
import { messageStatus } from './status.ts';

export const message = doc({
  contactId: id,
  campaignId: id.optional(),
  enrollmentId: id.optional(),
  stepIndex: count.optional(),
  direction: z.enum(['outbound', 'inbound']),
  variantId: id.optional(),
  status: messageStatus,
  from: z.string().optional(),
  to: z.string().optional(),
  subject: z.string(),
  body: z.string(),
  gmailId: z.string().optional(),
  threadId: z.string().optional(),
  /** RFC 5322 `Message-ID`, used for `In-Reply-To` / `References` threading. */
  rfcMessageId: z.string().optional(),
  /** Unique: a retried job or a duplicate push never creates a second message. */
  idempotencyKey: z.string().min(1),
  scheduledAt: z.date().optional(),
  sentAt: z.date().optional(),
  error: z.string().optional(),
});
export type Message = z.infer<typeof message>;

export const trackingKind = z.enum(['open', 'click', 'unsubscribe']);

export const trackingEvent = doc({
  messageId: id,
  variantId: id.optional(),
  kind: trackingKind,
  /** Privacy-proxy prefetch or a too-fast open; excluded from human opens. */
  machine: z.boolean(),
  url: z.url().optional(),
  at: z.date(),
});
export type TrackingEvent = z.infer<typeof trackingEvent>;

export const replyIntent = z.enum([
  'interested',
  'meeting_request',
  'question',
  'objection',
  'not_now',
  'not_interested',
  'unsubscribe',
  'out_of_office',
  'wrong_person',
  'referral',
  'other',
]);
export type ReplyIntent = z.infer<typeof replyIntent>;
/** Intents that count as a positive reply for the optimizer. */
export const POSITIVE_INTENTS = [
  'interested',
  'meeting_request',
  'question',
] as const satisfies readonly ReplyIntent[];

/** Reply analyst output (PR 14). */
export const replyAnalysis = z.object({
  intent: replyIntent,
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  language: locale,
  summaryEn: z.string().max(200),
  proposedTimes: z.array(z.object({ start: z.iso.datetime(), end: z.iso.datetime() })).optional(),
  followUpAt: z.iso.datetime().optional(),
  referral: z.object({ name: z.string(), email: z.email().optional() }).optional(),
  suggestedReply: z.string().optional(),
});
export type ReplyAnalysis = z.infer<typeof replyAnalysis>;

export const reply = doc({
  /** The inbound message analysed; one analysis per message. */
  messageId: id,
  contactId: id,
  /** Attribution: the campaign, step and variant that earned the reply. */
  campaignId: id.optional(),
  stepIndex: count.optional(),
  variantId: id.optional(),
  ...replyAnalysis.shape,
  at: z.date(),
});
export type Reply = z.infer<typeof reply>;

export const meeting = doc({
  contactId: id,
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: timezone.optional(),
  calendarEventId: z.string(),
  meetUrl: z.url(),
});
export type Meeting = z.infer<typeof meeting>;
