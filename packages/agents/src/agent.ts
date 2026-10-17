import { type BaseLlm, LlmAgent, type ReadonlyContext, type ToolUnion } from '@google/adk';
import { HarmBlockThreshold, HarmCategory } from '@google/genai';
import type { z } from 'zod';
import './llm/lite-llm.ts';
import { prompt, untrustedGuard } from './prompts/base.ts';

export type ModelAlias = 'sutra-fast' | 'sutra-smart';

/** An `LlmAgent` that remembers its Zod output schema, so `runAgent` can type and validate it. */
export type Agent<O extends z.ZodObject | undefined = z.ZodObject | undefined> = LlmAgent & {
  readonly output: O;
};

export interface AgentSpec<O extends z.ZodObject | undefined> {
  name: string;
  description?: string;
  /** A LiteLLM alias, or a `BaseLlm` (Gemini direct for search grounding; fakes in tests). */
  model?: ModelAlias | BaseLlm;
  /** Fragments joined into the instruction. `{key}`, `{key?}` and `{workspace.path}` read state. */
  instruction: string | string[];
  output?: O;
  tools?: ToolUnion[];
  temperature?: number;
}

const SAFETY = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }));

// A single-brace `{key}` reads state. A double-brace `{{mergeField}}` is a literal (email merge
// fields like `{{firstName}}`), so the lookbehind/lookahead skip any `{` preceded by `{` or `}`
// followed by `}`, leaving merge fields untouched.
const PLACEHOLDER = /(?<!\{)\{([A-Za-z_][\w:]*(?:\.[A-Za-z_]\w*)*)(\?)?\}(?!\})/g;

/**
 * Fills `{key}` / `{a.b.c}` / `{key?}` from state; a missing required key is an error.
 * Literal `{{...}}` merge fields are left as-is.
 */
export function renderTemplate(template: string, state: { get: (key: string) => unknown }) {
  return template.replace(PLACEHOLDER, (_, path: string, optional?: string) => {
    const [head = '', ...rest] = path.split('.');
    let value = state.get(head);
    for (const key of rest) value = (value as Record<string, unknown> | undefined)?.[key];
    if (value === undefined || value === null) {
      if (optional) return '';
      throw new Error(`Instruction references missing state "${path}"`);
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

const registry = new Map<string, Agent>();
/** Every agent defined so far, by name (for `pnpm agent:try` and the agent graph). */
export const agents = (): ReadonlyMap<string, Agent> => registry;

/**
 * The one way to make an agent: shared safety settings, the untrusted-content preamble,
 * state templating and a default temperature, on top of ADK's `LlmAgent`.
 */
export function defineAgent<O extends z.ZodObject | undefined = undefined>(
  spec: AgentSpec<O>,
): Agent<O> {
  const template = prompt(untrustedGuard, ...[spec.instruction].flat());
  const agent = new LlmAgent({
    name: spec.name,
    description: spec.description,
    model: spec.model ?? 'sutra-fast',
    instruction: (ctx: ReadonlyContext) => renderTemplate(template, ctx.state),
    outputSchema: spec.output,
    tools: spec.tools,
    generateContentConfig: { temperature: spec.temperature ?? 0.4, safetySettings: SAFETY },
  });
  const defined = Object.assign(agent, { output: spec.output as O });
  registry.set(spec.name, defined);
  return defined;
}
