import { FunctionTool } from '@google/adk';
import type { z } from 'zod';
import { sideEffect } from '../safety.ts';

/**
 * One chat tool, described independently of where it comes from. In the app each spec is built
 * from a Server Action (one definition, many uses): `parameters` is the action's own Zod input and
 * `execute` runs the action under the signed-in user's auth, so a chat tool can never do more than
 * the same action in the UI.
 */
export interface ChatToolSpec {
  name: string;
  description: string;
  /** The action's Zod input schema — the exact parameters the model is shown and validated against. */
  parameters: z.ZodObject;
  /** A mutation: requires the user's confirmation in chat, and is gated by the safety plugins. */
  confirm?: boolean;
  /** Runs the underlying action with the model-supplied (and ADK-validated) arguments. */
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Builds an ADK `FunctionTool` from a spec. A mutating tool requires confirmation (ADK's HITL
 * gate → a confirm card in chat) and is marked side-effecting, so it also passes the compliance
 * hook and, critically, is blocked by the injection guard in any turn that handled untrusted
 * content trying to instruct the agent.
 */
export function chatTool(spec: ChatToolSpec): FunctionTool {
  const tool = new FunctionTool({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    requireConfirmation: spec.confirm ?? false,
    execute: (args) => spec.execute(args as Record<string, unknown>),
  });
  return spec.confirm ? sideEffect(tool) : tool;
}

export const chatTools = (specs: ChatToolSpec[]): FunctionTool[] => specs.map(chatTool);
