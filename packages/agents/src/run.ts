import {
  type BasePlugin,
  type Event,
  getFunctionResponses,
  isFinalResponse,
  type LlmAgent,
  LogLevel,
  Runner,
  StreamingMode,
  setLogLevel,
} from '@google/adk';
import type { Content } from '@google/genai';
import { audit, LlmUsage } from '@sutra/db';
import { MongoSessionService } from '@sutra/db/adk';
import type { Id } from '@sutra/domain';
import { log, metrics, tracer } from '@sutra/obs';
import { z } from 'zod';
import { RateLimiter } from './llm/rate-limit.ts';
import { PipelineRecorder } from './pipeline/recorder.ts';
import { InjectionGuard, ToolGuard } from './safety.ts';

export const APP_NAME = 'sutra';

// ADK logs every plugin registration and request at INFO; one runner is built per run.
setLogLevel(LogLevel.WARN);

export type Usage = { tokensIn: number; tokensOut: number; costUsd: number };

/** The agent's final output failed its schema twice (the first failure is retried). */
export class AgentOutputError extends Error {
  override name = 'AgentOutputError';
  readonly agent: string;
  readonly issues: string;
  readonly raw: string;

  constructor(agent: string, issues: string, raw: string) {
    super(`Agent "${agent}" returned invalid output after a retry:\n${issues}`);
    this.agent = agent;
    this.issues = issues;
    this.raw = raw;
  }
}

/** The model call ended in an error response (blocked, quota, proxy failure...). */
export class AgentRunError extends Error {
  override name = 'AgentRunError';
  readonly agent: string;
  readonly code: string;

  constructor(agent: string, code: string, message: string) {
    super(`Agent "${agent}" failed (${code}): ${message}`);
    this.agent = agent;
    this.code = code;
  }
}

type OutputOf<A> = A extends { output: infer S extends z.ZodType } ? z.infer<S> : string;

export interface RunAgentOptions<A extends LlmAgent, O extends z.ZodType | undefined> {
  agent: A;
  workspaceId: Id;
  /** Stable conversation key, e.g. `lead:${leadId}`. The same key resumes the same session. */
  sessionKey: string;
  input: string | Content;
  /** Overrides the agent's own output schema. */
  output?: O;
  /** Merged into session state before the run (templated into `{key}` placeholders). */
  state?: Record<string, unknown>;
  /** ADK user id; defaults to the workspace, so `user:` state is workspace-wide. */
  userId?: string;
  plugins?: BasePlugin[];
  /** Streams partial text to `onEvent` as it arrives. */
  stream?: boolean;
  onEvent?: (event: Event) => void;
  signal?: AbortSignal;
}

export interface RunAgentResult<T> {
  output: T;
  text: string;
  events: Event[];
  usage: Usage;
}

const userMessage = (input: string | Content): Content =>
  typeof input === 'string' ? { role: 'user', parts: [{ text: input }] } : input;

/** Final text of the run: the last final response, or what `set_model_response` submitted. */
function finalText(events: Event[]): string {
  for (const event of events.toReversed()) {
    if (event.author === 'user' || !isFinalResponse(event)) continue;
    const submitted = getFunctionResponses(event).find((r) => r.name === 'set_model_response');
    if (submitted) {
      const result = submitted.response?.result ?? submitted.response;
      return typeof result === 'string' ? result : JSON.stringify(result);
    }
    const text = (event.content?.parts ?? [])
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join('');
    if (text) return text;
  }
  return '';
}

function parseOutput(schema: z.ZodType, text: string) {
  const json = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { success: false as const, issues: 'The reply was not valid JSON.' };
  }
  const result = schema.safeParse(value);
  return result.success
    ? { success: true as const, data: result.data }
    : { success: false as const, issues: z.prettifyError(result.error) };
}

const usageOf = (events: Event[]): Usage =>
  events.reduce(
    (u, e) => ({
      tokensIn: u.tokensIn + (e.usageMetadata?.promptTokenCount ?? 0),
      tokensOut: u.tokensOut + (e.usageMetadata?.candidatesTokenCount ?? 0),
      costUsd: u.costUsd + Number(e.customMetadata?.costUsd ?? 0),
    }),
    { tokensIn: 0, tokensOut: 0, costUsd: 0 },
  );

/**
 * Runs an agent in a Mongo-backed session: resumes or creates the session for `sessionKey`,
 * validates the structured output (one corrective retry), records `llm_usage` and an audit event.
 */
export async function runAgent<A extends LlmAgent, O extends z.ZodType | undefined = undefined>(
  opts: RunAgentOptions<A, O>,
): Promise<RunAgentResult<O extends z.ZodType ? z.infer<O> : OutputOf<A>>> {
  const { agent, workspaceId, sessionKey: sessionId } = opts;
  const userId = opts.userId ?? workspaceId;
  const schema = (opts.output ?? (agent as { output?: z.ZodType }).output) as z.ZodType | undefined;
  const sessionService = new MongoSessionService(workspaceId);
  const runner = new Runner({
    appName: APP_NAME,
    agent,
    sessionService,
    plugins: [
      new InjectionGuard(workspaceId),
      new ToolGuard(workspaceId),
      new RateLimiter(),
      new PipelineRecorder(),
      ...(opts.plugins ?? []),
    ],
  });

  const existing = await sessionService.getSession({ appName: APP_NAME, userId, sessionId });
  if (!existing)
    await sessionService.createSession({ appName: APP_NAME, userId, sessionId, state: opts.state });

  const events: Event[] = [];
  const turn = async (message: Content, stateDelta?: Record<string, unknown>) => {
    const from = events.length;
    for await (const event of runner.runAsync({
      userId,
      sessionId,
      newMessage: message,
      stateDelta,
      runConfig: { streamingMode: opts.stream ? StreamingMode.SSE : StreamingMode.NONE },
      abortSignal: opts.signal,
    })) {
      opts.onEvent?.(event);
      if (event.partial) continue;
      events.push(event);
      if (event.errorCode)
        throw new AgentRunError(agent.name, event.errorCode, event.errorMessage ?? '');
    }
    return finalText(events.slice(from));
  };

  const actor = { kind: 'agent', id: agent.name } as const;
  const target = { entity: 'adk_session', entityId: sessionId };
  const model = typeof agent.model === 'string' ? agent.model : (agent.model?.model ?? 'unknown');

  // One span per agent run, joined to the trace of the enclosing pipeline node/job, so the agent run
  // → its LLM calls → tool calls → any send all sit under one trace with the run's correlation ids.
  return tracer().withSpan(`agent:${agent.name}`, async (span) => {
    span.setAttributes({ 'agent.name': agent.name, 'llm.model': model });
    try {
      let text = await turn(userMessage(opts.input), existing ? opts.state : undefined);
      let output: unknown = text;
      for (let attempt = 1; schema; attempt++) {
        const parsed = parseOutput(schema, text);
        if (parsed.success) {
          output = parsed.data;
          break;
        }
        if (attempt === 2) {
          await audit(workspaceId, actor, 'agent.output_invalid', {
            ...target,
            data: { issues: parsed.issues },
          });
          throw new AgentOutputError(agent.name, parsed.issues, text);
        }
        text = await turn(
          userMessage(
            `Your reply did not match the required output schema:\n${parsed.issues}\nReply again with only the corrected JSON.`,
          ),
        );
      }
      const usage = usageOf(events);
      await audit(workspaceId, actor, 'agent.run', { ...target, data: { ...usage } });
      span.setAttributes({
        'llm.tokens_in': usage.tokensIn,
        'llm.tokens_out': usage.tokensOut,
        'llm.cost_usd': usage.costUsd,
      });
      metrics().observe('llm.tokens', usage.tokensIn + usage.tokensOut, {
        agent: agent.name,
        model,
      });
      metrics().observe('llm.cost_usd', usage.costUsd, { agent: agent.name, model });
      log().info('agent.run', { agent: agent.name, model, ...usage });
      return { output: output as never, text, events, usage };
    } finally {
      const usage = usageOf(events);
      if (usage.tokensIn || usage.tokensOut)
        await LlmUsage.create(workspaceId, {
          agent: agent.name,
          model,
          ...usage,
          at: new Date(),
        });
    }
  });
}
