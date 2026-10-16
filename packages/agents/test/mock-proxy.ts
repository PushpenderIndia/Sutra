import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll } from 'vitest';
import { LiteLlm } from '../src/llm/lite-llm.ts';

type Json = Record<string, unknown>;
export type Reply =
  | { json: Json; cost?: number }
  | { sse: Json[]; cost?: number }
  | { status: number; body: string };

export const toolCall = (id: string, name: string, args: Json) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

/** A `/chat/completions` reply with token usage. */
export const completion = (
  content: string | null,
  { toolCalls, tokens = [10, 5] }: { toolCalls?: Json[]; tokens?: [number, number] } = {},
): Json => ({
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content, ...(toolCalls && { tool_calls: toolCalls }) },
      finish_reason: toolCalls ? 'tool_calls' : 'stop',
    },
  ],
  usage: {
    prompt_tokens: tokens[0],
    completion_tokens: tokens[1],
    total_tokens: tokens[0] + tokens[1],
  },
});

/**
 * A fake LiteLLM proxy (OpenAI-compatible). Replies are served in order; when none are queued
 * it answers "ok". Every request body is recorded. Closed automatically after the file.
 */
export async function mockProxy() {
  const requests: (Json & { messages: Json[] })[] = [];
  const headers: Record<string, string | string[] | undefined>[] = [];
  const replies: Reply[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    headers.push(req.headers);
    const reply = replies.shift() ?? { json: completion('ok') };
    if ('status' in reply) {
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(reply.body);
      return;
    }
    const cost = { 'x-litellm-response-cost': String(reply.cost ?? 0) };
    if ('json' in reply) {
      res
        .writeHead(200, { 'content-type': 'application/json', ...cost })
        .end(JSON.stringify(reply.json));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', ...cost });
    for (const chunk of reply.sse) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return {
    url,
    requests,
    headers,
    reply: (...r: Reply[]) => replies.push(...r),
    /** A `LiteLlm` for `alias` pointed at this proxy. */
    model: (alias = 'sutra-fast') => new LiteLlm({ model: alias, baseUrl: url, apiKey: 'sk-test' }),
  };
}
