import type { BaseLlm, ToolUnion } from '@google/adk';
import { type Agent, defineAgent, type ModelAlias } from '../agent.ts';

/** Session state the copilot reads each turn, so it knows what the user is looking at. */
export interface CopilotState {
  /** The workspace name — "You operate Sutra for {workspace}". */
  workspace: string;
  /** The tab on screen (business · prospects · campaigns · leads), or absent. */
  tab?: string;
  /** A human description of the selected rows ("3 prospects selected: …"), or absent. */
  selection?: string;
  /** The active campaign, when one is in context. */
  activeCampaign?: string;
}

export const COPILOT_NAME = 'copilot';

const SYSTEM = [
  'You are Sutra, the copilot that operates an autonomous sales-outreach workspace. You operate Sutra for {workspace}.',
  'You help the user steer the system in plain language: explain why a prospect fits, edit the business profile or ICP, rewrite or regenerate a step, pause or resume a campaign, exclude prospects, approve a drafted reply, book a meeting.',
  'Always act through your tools. Never claim you have changed, paused, excluded, booked or approved anything unless a tool returned a successful result — if a tool was not called or failed, say so plainly.',
  'Read tools answer questions and never need confirmation. Tools that change data ask the user to confirm first; after you call such a tool, tell the user you are waiting for their confirmation rather than claiming it is done.',
  'Every change respects the same roles as the UI: if a tool reports it is forbidden, explain that the user lacks the role, and do not retry.',
  "Be concise. Answer in the user's language. Cite the sources a tool returns when you explain a score or a fact.",
].join('\n\n');

// Read each turn from session state; absent context is simply omitted.
const CONTEXT = [
  'Current context — resolve "this", "these", "the selected ones" and "here" against it:',
  'Active tab: {tab?}',
  'Selection: {selection?}',
  'Active campaign: {activeCampaign?}',
].join('\n');

/**
 * The `copilot` agent (`sutra-smart`). Its tools are the app's Server Actions, passed in by the
 * caller, so one definition serves the UI and the chat. `model` is overridable for tests (a mock
 * proxy); production uses the smart alias.
 */
export function copilotAgent(tools: ToolUnion[], model?: ModelAlias | BaseLlm): Agent {
  return defineAgent({
    name: COPILOT_NAME,
    description: 'Operates Sutra in chat: answers questions and makes changes via the app actions.',
    model: model ?? 'sutra-smart',
    instruction: [SYSTEM, CONTEXT],
    tools,
    temperature: 0.3,
  });
}
