import {
  type BaseLlm,
  getFunctionResponses,
  REQUEST_CONFIRMATION_FUNCTION_CALL_NAME,
} from '@google/adk';
import type { Content } from '@google/genai';
import type { Id } from '@sutra/domain';
import type { ModelAlias } from '../agent.ts';
import { runAgent, type Usage } from '../run.ts';
import { type PendingConfirmation, pendingConfirmation } from './confirm.ts';
import { type CopilotState, copilotAgent } from './copilot.ts';
import { type ChatToolSpec, chatTools } from './tools.ts';

export interface RunCopilotOptions {
  workspaceId: Id;
  /** The signed-in user — the session is per user, so history is theirs alone. */
  userId: string;
  /** Stable per-user conversation key, so the chat resumes with its history. */
  sessionKey: string;
  /** A user message, or the function-response `Content` from {@link confirmationReply} on resume. */
  input: string | Content;
  /** The app's Server Actions as tool specs (see the registry). */
  specs: ChatToolSpec[];
  /** Tab/selection/active campaign, injected into the system prompt each turn. */
  state?: CopilotState;
  /** Overridable for tests (a mock proxy); production uses the smart alias. */
  model?: ModelAlias | BaseLlm;
  /** Streams assistant tokens as they arrive. */
  onToken?: (text: string) => void;
  /** Called with each read tool's result, for inline rich results in the UI. */
  onToolResult?: (name: string, result: unknown) => void;
  signal?: AbortSignal;
}

export interface CopilotTurn {
  /** The assistant's text (empty when the turn ended waiting for a confirmation). */
  text: string;
  /** Set when the model asked to run a mutation and is waiting for the user to confirm. */
  confirmation?: PendingConfirmation;
  usage: Usage;
}

const textOf = (parts: { text?: string; thought?: boolean }[] = []) =>
  parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join('');

/**
 * One copilot turn: builds the agent from the action tools, runs it in the user's Mongo-backed
 * session, streams tokens and read-tool results, and reports any pending mutation confirmation.
 * Resuming a confirmation is just another call with {@link confirmationReply} as `input`.
 */
export async function runCopilot(opts: RunCopilotOptions): Promise<CopilotTurn> {
  const agent = copilotAgent(chatTools(opts.specs), opts.model);
  const result = await runAgent({
    agent,
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    sessionKey: opts.sessionKey,
    input: opts.input,
    state: opts.state as Record<string, unknown> | undefined,
    stream: Boolean(opts.onToken),
    signal: opts.signal,
    onEvent: (event) => {
      if (event.partial) {
        const token = textOf(event.content?.parts ?? []);
        if (token) opts.onToken?.(token);
        return;
      }
      for (const response of getFunctionResponses(event))
        if (
          response.name &&
          response.name !== REQUEST_CONFIRMATION_FUNCTION_CALL_NAME &&
          response.response
        )
          opts.onToolResult?.(response.name, response.response);
    },
  });

  return {
    text: result.text,
    confirmation: pendingConfirmation(result.events),
    usage: result.usage,
  };
}
