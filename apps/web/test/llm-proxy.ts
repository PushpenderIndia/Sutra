import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LiteLlm } from '@sutra/agents';
import { afterAll } from 'vitest';

/**
 * A tiny OpenAI-compatible LiteLLM proxy for chat tests: scripted replies, no network. Mirrors the
 * agents package's mock proxy, re-implemented here because its test helper isn't a package export.
 */
type Json = Record<string, unknown>;

export const toolCall = (id: string, name: string, args: Json) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

export const completion = (content: string | null, toolCalls?: Json[]): Json => ({
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content, ...(toolCalls && { tool_calls: toolCalls }) },
      finish_reason: toolCalls ? 'tool_calls' : 'stop',
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
});

export async function mockLlm() {
  const replies: Json[] = [];
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) void _chunk;
    const reply = replies.shift() ?? completion('ok');
    res
      .writeHead(200, { 'content-type': 'application/json', 'x-litellm-response-cost': '0' })
      .end(JSON.stringify(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return {
    reply: (...r: Json[]) => replies.push(...r),
    model: () => new LiteLlm({ model: 'sutra-smart', baseUrl: url, apiKey: 'sk-test' }),
  };
}
