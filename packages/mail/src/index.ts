import 'server-only';

/**
 * `@sutra/mail`: sends from the workspace's own Gmail (or the `FAKE_MAIL` simulator), threads
 * follow-ups, tracks opens and clicks, and syncs replies and bounces from Gmail push.
 */
export {
  CALENDAR_API,
  type CalendarClient,
  type CalendarEvent,
  type CalendarEventInput,
  calendarFor,
  fakeCalendarClient,
  googleCalendarClient,
  type Interval,
} from './calendar.ts';
export {
  type CheckStatus,
  type Deliverability,
  type DnsCheck,
  deliverability,
} from './deliverability.ts';
export { fakeClient, type ScriptedEvent, script, simulate } from './fake.ts';
export {
  accessToken,
  GMAIL_API,
  GoogleApiError,
  gmailClient,
  type InboundMail,
  type MailClient,
  parseMessage,
  TOKEN_URL,
} from './gmail.ts';
export {
  clientFor,
  connectMailbox,
  googleRefreshToken,
  MailboxError,
  mailboxFor,
  pubsubTopic,
  renewWatches,
  startWatch,
} from './mailbox.ts';
export { buildMime, type Mime } from './mime.ts';
export { contentIssues, linksIn, MAX_LINKS, render } from './render.ts';
export { type SendReplyOptions, sendReply } from './reply-send.ts';
export {
  type DeliverOptions,
  type DeliverResult,
  deliver,
  GAP_MS,
  nextSlot,
  type SendOptions,
  send,
} from './send.ts';
export { BOUNCE_LIMIT, ingest, onGmailPush, onReply, syncMailbox } from './sync.ts';
export {
  clickToken,
  type Hit,
  isMachine,
  MACHINE_WINDOW_MS,
  openToken,
  recordClick,
  recordEvent,
  recordOpen,
  trackingFor,
} from './tracking.ts';
