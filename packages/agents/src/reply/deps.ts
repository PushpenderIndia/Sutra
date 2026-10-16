import { env } from '@sutra/config';
import type { Mailbox } from '@sutra/domain';
import { type CalendarClient, calendarFor as realCalendarFor } from '@sutra/mail';
import { fakeReplyAnalyzer, LlmReplyAnalyzer, type ReplyAnalyzer } from './analyzer.ts';

/**
 * The reply analyst's external collaborators behind one seam (mirrors the profiler / enricher /
 * copywriter): the language model and Google Calendar. Real implementations by default; the
 * heuristic analyser and the fake calendar in tests and `FAKE_MAIL` demo mode.
 */
export interface ReplyDeps {
  analyzer: ReplyAnalyzer;
  /** The calendar for a workspace mailbox (free/busy + event creation). */
  calendarFor: (mailbox: Mailbox) => CalendarClient;
}

let override: Partial<ReplyDeps> = {};

/** Overrides some or all reply dependencies (tests, demo seeding). Pass `{}` to reset. */
export const setReplyDeps = (deps: Partial<ReplyDeps>) => {
  override = deps;
};

function defaults(): ReplyDeps {
  const fake = env.NODE_ENV === 'test' || env.FAKE_MAIL;
  return {
    analyzer: fake ? fakeReplyAnalyzer() : new LlmReplyAnalyzer(),
    calendarFor: realCalendarFor,
  };
}

export const replyDeps = (): ReplyDeps => ({ ...defaults(), ...override });
