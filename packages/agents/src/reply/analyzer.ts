import type { Id, Locale, ReplyAnalysis } from '@sutra/domain';
import { untrusted } from '../prompts/base.ts';
import { runAgent } from '../run.ts';
import { replyAnalyst } from './analyst.ts';
import { heuristicAnalyze } from './heuristic.ts';

/** What the analyser is given about one inbound reply. The reply text itself is untrusted. */
export interface ReplyAnalysisInput {
  workspaceId: Id;
  /** The inbound message id; the stable session key for the analyst. */
  messageId: Id;
  /** The reply body (untrusted content). */
  reply: string;
  /** The contact's locale, as a language hint. */
  locale?: Locale;
  /** The earlier thread, oldest first, rendered as text (optional context). */
  thread?: string;
  /** A one-line ICP summary, so the analyst reads the reply against who we target. */
  icpSummary?: string;
}

/**
 * Turns one inbound reply into a structured {@link ReplyAnalysis}. Behind an interface so every
 * external call (the LLM) has a network-free fake for tests and demo mode.
 */
export interface ReplyAnalyzer {
  analyze(input: ReplyAnalysisInput): Promise<ReplyAnalysis>;
}

const promptFor = (input: ReplyAnalysisInput): string =>
  [
    input.icpSummary && `Who we target (ICP): ${input.icpSummary}`,
    input.thread && `Earlier thread:\n${untrusted(input.thread, 'thread')}`,
    input.locale && `The contact usually writes in: ${input.locale}`,
    `The reply to analyse:\n${untrusted(input.reply, 'reply')}`,
  ]
    .filter(Boolean)
    .join('\n\n');

/** Production analyser: the `replyAnalyst` LLM (`sutra-smart`), validated against the schema. */
export class LlmReplyAnalyzer implements ReplyAnalyzer {
  async analyze(input: ReplyAnalysisInput): Promise<ReplyAnalysis> {
    const { output } = await runAgent({
      agent: replyAnalyst,
      workspaceId: input.workspaceId,
      sessionKey: `reply:${input.workspaceId}:${input.messageId}`,
      input: promptFor(input),
    });
    return output;
  }
}

/**
 * A {@link ReplyAnalyzer} for tests and `FAKE_MAIL` demo mode: the deterministic multilingual
 * heuristic, with optional per-reply overrides (e.g. proposed meeting times) keyed by reply text.
 */
export function fakeReplyAnalyzer(
  overrides: Record<string, Partial<ReplyAnalysis>> = {},
): ReplyAnalyzer {
  const key = (s: string) => s.trim().replace(/\s+/g, ' ');
  const byKey = new Map(Object.entries(overrides).map(([k, v]) => [key(k), v]));
  return {
    analyze: async (input) => {
      const base = heuristicAnalyze(input.reply, input.locale);
      const override = byKey.get(key(input.reply));
      return override ? { ...base, ...override } : base;
    },
  };
}
