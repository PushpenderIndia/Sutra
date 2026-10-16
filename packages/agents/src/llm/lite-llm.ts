import {
  BaseLlm,
  type BaseLlmConnection,
  genaiSchemaToJsonSchema,
  LLMRegistry,
  type LlmRequest,
  type LlmResponse,
} from '@google/adk';
import {
  type Content,
  type ContentUnion,
  FinishReason,
  type FunctionCall,
  type Part,
  type Schema,
} from '@google/genai';
import { env } from '@sutra/config';

type Json = Record<string, unknown>;
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type Message =
  | { role: 'system' | 'user'; content: string | Json[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
type Choice = {
  message?: { content?: string | null; tool_calls?: ToolCall[] };
  delta?: { content?: string | null; tool_calls?: (Partial<ToolCall> & { index: number })[] };
  finish_reason?: string | null;
};
type Completion = { choices?: Choice[]; usage?: Usage | null };

/** The proxy answered with a non-2xx status. A 429 means the free-tier quota is exhausted. */
export class LlmHttpError extends Error {
  override name = 'LlmHttpError';
  readonly status: number;

  constructor(status: number, body: string) {
    super(`LiteLLM proxy returned ${status}: ${body.slice(0, 500)}`);
    this.status = status;
  }
}

const FINISH: Record<string, FinishReason> = {
  stop: FinishReason.STOP,
  tool_calls: FinishReason.STOP,
  length: FinishReason.MAX_TOKENS,
  content_filter: FinishReason.SAFETY,
};

const asParts = (c: ContentUnion): Part[] =>
  typeof c === 'string'
    ? [{ text: c }]
    : Array.isArray(c)
      ? c.flatMap(asParts)
      : 'parts' in c
        ? ((c as Content).parts ?? [])
        : [c as Part];
const textOf = (parts: Part[]) =>
  parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join('');
const jsonSchema = (s: unknown): Json => genaiSchemaToJsonSchema(s as Schema) as Json;

/** ADK request → OpenAI-compatible messages. */
function toMessages(req: LlmRequest): Message[] {
  const system = req.config?.systemInstruction;
  const messages: Message[] = system ? [{ role: 'system', content: textOf(asParts(system)) }] : [];
  for (const { role, parts = [] } of req.contents) {
    if (role === 'model') {
      const calls = parts.flatMap((p) => (p.functionCall ? [p.functionCall] : []));
      messages.push({
        role: 'assistant',
        content: textOf(parts) || null,
        ...(calls.length && {
          tool_calls: calls.map((c) => ({
            id: c.id ?? '',
            type: 'function' as const,
            function: { name: c.name ?? '', arguments: JSON.stringify(c.args ?? {}) },
          })),
        }),
      });
      continue;
    }
    for (const p of parts) {
      if (p.functionResponse)
        messages.push({
          role: 'tool',
          tool_call_id: p.functionResponse.id ?? '',
          content: JSON.stringify(p.functionResponse.response ?? {}),
        });
    }
    const images = parts.filter((p) => p.inlineData?.data);
    const text = textOf(parts);
    if (images.length)
      messages.push({
        role: 'user',
        content: [
          ...(text ? [{ type: 'text', text }] : []),
          ...images.map(({ inlineData: d }) => ({
            type: 'image_url',
            image_url: { url: `data:${d?.mimeType};base64,${d?.data}` },
          })),
        ],
      });
    else if (text) messages.push({ role: 'user', content: text });
  }
  return messages;
}

/** ADK request → `/chat/completions` body. */
export function toChatRequest(req: LlmRequest, model: string, stream: boolean): Json {
  const c = req.config ?? {};
  const tools = (c.tools ?? []).flatMap((t) =>
    'functionDeclarations' in t
      ? (t.functionDeclarations ?? []).map((f) => ({
          type: 'function',
          function: {
            name: f.name,
            description: f.description,
            parameters: (f.parametersJsonSchema as Json | undefined) ??
              (f.parameters && jsonSchema(f.parameters)) ?? { type: 'object', properties: {} },
          },
        }))
      : [],
  );
  const schema =
    (c.responseJsonSchema as Json | undefined) ??
    (c.responseSchema && jsonSchema(c.responseSchema));
  const responseFormat = schema
    ? { type: 'json_schema', json_schema: { name: 'output', schema } }
    : c.responseMimeType === 'application/json'
      ? { type: 'json_object' }
      : undefined;
  const body: Json = {
    model: req.model ?? model,
    messages: toMessages(req),
    stream,
    ...(stream && { stream_options: { include_usage: true } }),
    ...(tools.length && { tools }),
    response_format: responseFormat,
    temperature: c.temperature,
    top_p: c.topP,
    max_tokens: c.maxOutputTokens,
    stop: c.stopSequences,
    seed: c.seed,
    presence_penalty: c.presencePenalty,
    frequency_penalty: c.frequencyPenalty,
    // Gemini-specific; LiteLLM forwards it to Gemini and drops it for other providers.
    safety_settings: c.safetySettings,
  };
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
}

/** OpenAI-compatible reply → ADK response. `x-litellm-response-cost` lands in `customMetadata`. */
function toLlmResponse(
  text: string,
  calls: ToolCall[],
  finish: string | null | undefined,
  usage: Usage | null | undefined,
  costUsd: number,
): LlmResponse {
  const parts: Part[] = [
    ...(text ? [{ text }] : []),
    ...calls.map(
      (c): Part => ({
        functionCall: {
          id: c.id,
          name: c.function.name,
          args: c.function.arguments ? JSON.parse(c.function.arguments) : {},
        } satisfies FunctionCall,
      }),
    ),
  ];
  return {
    content: { role: 'model', parts },
    finishReason: finish ? (FINISH[finish] ?? FinishReason.OTHER) : undefined,
    turnComplete: true,
    usageMetadata: usage
      ? {
          promptTokenCount: usage.prompt_tokens,
          candidatesTokenCount: usage.completion_tokens,
          totalTokenCount: usage.total_tokens,
        }
      : undefined,
    customMetadata: { costUsd },
  };
}

async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<Completion> {
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
}

/**
 * Any model behind the LiteLLM proxy, through its OpenAI-compatible API. Agents name an
 * alias from `infra/litellm/config.yaml` (`sutra-fast`, `sutra-smart`), never a provider model.
 */
export class LiteLlm extends BaseLlm {
  // ADK matches the whole name, so this is "^sutra-".
  static override readonly supportedModels = [/sutra-.+/];
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor({ model, baseUrl, apiKey }: { model: string; baseUrl?: string; apiKey?: string }) {
    super({ model });
    this.baseUrl = (baseUrl ?? env.LITELLM_BASE_URL).replace(/\/$/, '');
    this.apiKey = apiKey ?? env.LITELLM_API_KEY;
  }

  async *generateContentAsync(
    req: LlmRequest,
    stream = false,
    signal?: AbortSignal,
  ): AsyncGenerator<LlmResponse, void> {
    this.maybeAppendUserContent(req);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(toChatRequest(req, this.model, stream)),
      signal,
    });
    if (!res.ok) throw new LlmHttpError(res.status, await res.text());
    const cost = Number(res.headers.get('x-litellm-response-cost') ?? 0) || 0;

    if (!stream || !res.body) {
      const json = (await res.json()) as Completion;
      const choice = json.choices?.[0];
      const m = choice?.message;
      yield toLlmResponse(
        m?.content ?? '',
        m?.tool_calls ?? [],
        choice?.finish_reason,
        json.usage,
        cost,
      );
      return;
    }

    let text = '';
    let finish: string | null | undefined;
    let usage: Usage | null | undefined;
    const calls: ToolCall[] = [];
    for await (const chunk of sse(res.body)) {
      usage = chunk.usage ?? usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      finish = choice.finish_reason ?? finish;
      const delta = choice.delta?.content;
      if (delta) {
        text += delta;
        yield { content: { role: 'model', parts: [{ text: delta }] }, partial: true };
      }
      for (const d of choice.delta?.tool_calls ?? []) {
        calls[d.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
        const call = calls[d.index] as ToolCall;
        call.id = d.id ?? call.id;
        call.function.name += d.function?.name ?? '';
        call.function.arguments += d.function?.arguments ?? '';
      }
    }
    yield toLlmResponse(text, calls.filter(Boolean), finish, usage, cost);
  }

  connect(): Promise<BaseLlmConnection> {
    throw new Error('LiteLlm does not support live (bidi) connections');
  }
}

LLMRegistry.register(LiteLlm);
