import {
  type Event,
  getFunctionCalls,
  getFunctionResponses,
  REQUEST_CONFIRMATION_FUNCTION_CALL_NAME,
} from '@google/adk';
import type { Content } from '@google/genai';

/**
 * The confirmation handshake for the chat copilot. When the model calls a tool marked
 * `requireConfirmation`, ADK pauses the turn and surfaces an `adk_request_confirmation`
 * function call whose args carry the pinned original call. The chat UI shows a confirm card;
 * resuming the run means sending back a function response for that call with the decision.
 */

/** A mutation the copilot is waiting for the user to confirm. */
export interface PendingConfirmation {
  /** The id of the `adk_request_confirmation` call — echoed back when resuming. */
  callId: string;
  /** The tool the model wants to run. */
  tool: string;
  /** The arguments it would run with. */
  args: Record<string, unknown>;
  /** A short human hint ("Edit the ideal customer profile"). */
  hint?: string;
}

type OriginalCall = { id?: string; name?: string; args?: Record<string, unknown> };
type ConfirmArgs = { originalFunctionCall?: OriginalCall; toolConfirmation?: { hint?: string } };

/**
 * The confirmation request the latest events surfaced, if any, that has not yet been answered
 * by a matching function response (so a resumed, already-answered request is ignored).
 */
export function pendingConfirmation(events: Event[]): PendingConfirmation | undefined {
  const answered = new Set(
    events.flatMap((e) =>
      getFunctionResponses(e)
        .filter((r) => r.name === REQUEST_CONFIRMATION_FUNCTION_CALL_NAME && r.id)
        .map((r) => r.id as string),
    ),
  );
  for (const event of events.toReversed())
    for (const call of getFunctionCalls(event)) {
      if (call.name !== REQUEST_CONFIRMATION_FUNCTION_CALL_NAME || !call.id) continue;
      if (answered.has(call.id)) continue;
      const args = (call.args ?? {}) as ConfirmArgs;
      const original = args.originalFunctionCall ?? {};
      return {
        callId: call.id,
        tool: original.name ?? 'unknown',
        args: original.args ?? {},
        hint: args.toolConfirmation?.hint,
      };
    }
  return undefined;
}

/**
 * The user turn that resumes a paused confirmation: a function response for the
 * `adk_request_confirmation` call carrying the decision. ADK's confirmation processor reads it
 * and either runs the pinned tool (`confirmed`) or returns a rejection the model apologises for.
 */
export function confirmationReply(callId: string, confirmed: boolean): Content {
  return {
    role: 'user',
    parts: [
      {
        functionResponse: {
          id: callId,
          name: REQUEST_CONFIRMATION_FUNCTION_CALL_NAME,
          response: { confirmed },
        },
      },
    ],
  };
}
