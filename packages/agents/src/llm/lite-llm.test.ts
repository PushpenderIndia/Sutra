import { FunctionTool, LLMRegistry, type LlmRequest, type LlmResponse } from '@google/adk';
import { Type } from '@google/genai';
import { AuditEvents, LlmUsage, newId } from '@sutra/db';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { completion, mockProxy, toolCall } from '../../test/mock-proxy.ts';
import { defineAgent } from '../agent.ts';
import { runAgent } from '../run.ts';
import { LiteLlm, LlmHttpError, toChatRequest } from './lite-llm.ts';

const proxy = await mockProxy();
const request = (overrides: Partial<LlmRequest> = {}): LlmRequest => ({
  contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
  toolsDict: {},
  liveConnectConfig: {},
  ...overrides,
});
const collect = async (gen: AsyncGenerator<LlmResponse>) => {
  const out: LlmResponse[] = [];
  for await (const r of gen) out.push(r);
  return out;
};

describe('LiteLlm', () => {
  it('is registered for sutra- aliases only', () => {
    expect(LLMRegistry.newLlm('sutra-fast')).toBeInstanceOf(LiteLlm);
    expect(LLMRegistry.newLlm('sutra-smart').model).toBe('sutra-smart');
    expect(LLMRegistry.newLlm('gemini-2.5-flash')).not.toBeInstanceOf(LiteLlm);
  });

  it('maps an ADK request to OpenAI messages, tools and response_format', () => {
    const body = toChatRequest(
      request({
        contents: [
          { role: 'user', parts: [{ text: 'Weather in Pune?' }] },
          {
            role: 'model',
            parts: [{ functionCall: { id: 'c1', name: 'weather', args: { city: 'Pune' } } }],
          },
          {
            role: 'user',
            parts: [{ functionResponse: { id: 'c1', name: 'weather', response: { c: 31 } } }],
          },
        ],
        config: {
          systemInstruction: 'Be brief.',
          temperature: 0.2,
          maxOutputTokens: 100,
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'weather',
                  description: 'Current weather',
                  parameters: {
                    type: Type.OBJECT,
                    properties: { city: { type: Type.STRING } },
                    required: ['city'],
                  },
                },
              ],
            },
          ],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: { celsius: { type: Type.NUMBER } },
            required: ['celsius'],
          },
        },
      }),
      'sutra-fast',
      false,
    );
    expect(body).toEqual({
      model: 'sutra-fast',
      stream: false,
      temperature: 0.2,
      max_tokens: 100,
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Weather in Pune?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [toolCall('c1', 'weather', { city: 'Pune' })],
        },
        { role: 'tool', tool_call_id: 'c1', content: '{"c":31}' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'weather',
            description: 'Current weather',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'output',
          schema: {
            type: 'object',
            properties: { celsius: { type: 'number' } },
            required: ['celsius'],
          },
        },
      },
    });
  });

  it('returns text, usage and the proxy-reported cost', async () => {
    proxy.reply({ json: completion('Hello!', { tokens: [12, 3] }), cost: 0.0004 });
    const [res] = await collect(proxy.model().generateContentAsync(request()));
    expect(res?.content?.parts).toEqual([{ text: 'Hello!' }]);
    expect(res?.usageMetadata).toMatchObject({ promptTokenCount: 12, candidatesTokenCount: 3 });
    expect(res?.customMetadata).toEqual({ costUsd: 0.0004 });
    expect(proxy.headers.at(-1)?.authorization).toBe('Bearer sk-test');
  });

  it('streams text deltas and assembles streamed tool calls', async () => {
    const delta = (d: object, finish: string | null = null) => ({
      choices: [{ index: 0, delta: d, finish_reason: finish }],
    });
    proxy.reply({
      sse: [
        delta({ role: 'assistant', content: 'Let me ' }),
        delta({ content: 'check.' }),
        delta({
          tool_calls: [
            { index: 0, id: 'c9', type: 'function', function: { name: 'weather', arguments: '' } },
          ],
        }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: '"Goa"}' } }] }, 'tool_calls'),
        { choices: [], usage: { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 } },
      ],
    });
    const out = await collect(proxy.model().generateContentAsync(request(), true));
    expect(proxy.requests.at(-1)).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(out.filter((r) => r.partial).map((r) => r.content?.parts?.[0]?.text)).toEqual([
      'Let me ',
      'check.',
    ]);
    const final = out.at(-1);
    expect(final?.partial).toBeUndefined();
    expect(final?.content?.parts).toEqual([
      { text: 'Let me check.' },
      { functionCall: { id: 'c9', name: 'weather', args: { city: 'Goa' } } },
    ]);
    expect(final?.usageMetadata?.totalTokenCount).toBe(11);
  });

  it('throws a typed error on a non-2xx reply', async () => {
    proxy.reply({ status: 429, body: '{"error":"rate limited"}' });
    const err = await collect(proxy.model().generateContentAsync(request())).catch((e) => e);
    expect(err).toBeInstanceOf(LlmHttpError);
    expect(err.status).toBe(429);
  });
});

describe('LiteLlm inside an agent run', () => {
  it('executes tool calls round trip and records usage', async () => {
    const ws = newId();
    let called: unknown;
    const weather = new FunctionTool({
      name: 'weather',
      description: 'Current weather for a city',
      parameters: z.object({ city: z.string() }),
      execute: async (args) => {
        called = args;
        return { celsius: 30 };
      },
    });
    const agent = defineAgent({
      name: 'weather_bot',
      model: proxy.model(),
      instruction: 'Answer weather questions.',
      tools: [weather],
    });
    proxy.reply(
      {
        json: completion(null, { toolCalls: [toolCall('t1', 'weather', { city: 'Pune' })] }),
        cost: 0.001,
      },
      { json: completion('It is 30°C in Pune.'), cost: 0.002 },
    );
    const from = proxy.requests.length;
    const result = await runAgent({ agent, workspaceId: ws, sessionKey: 'w:1', input: 'Pune?' });

    expect(called).toEqual({ city: 'Pune' });
    expect(result.output).toBe('It is 30°C in Pune.');
    const [first, second] = proxy.requests.slice(from);
    expect(first?.tools).toMatchObject([{ function: { name: 'weather' } }]);
    expect(second?.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 't1',
      content: JSON.stringify({ celsius: 30 }),
    });
    expect(result.usage).toEqual({ tokensIn: 20, tokensOut: 10, costUsd: 0.003 });
    const [usage] = await LlmUsage.find(ws);
    expect(usage).toMatchObject({ agent: 'weather_bot', model: 'sutra-fast', tokensIn: 20 });
    expect(await AuditEvents.find(ws, { action: 'agent.run' })).toHaveLength(1);
  });

  it('sends the output schema as json_schema and returns parsed output', async () => {
    const agent = defineAgent({
      name: 'scorer',
      model: proxy.model(),
      instruction: 'Score the lead.',
      output: z.object({ score: z.number().min(0).max(100), reason: z.string() }),
    });
    proxy.reply({ json: completion('{"score": 72, "reason": "fits ICP"}') });
    const from = proxy.requests.length;
    const { output } = await runAgent({ agent, workspaceId: newId(), sessionKey: 's', input: 'x' });
    expect(output.score).toBe(72);
    expect(proxy.requests[from]?.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { schema: { properties: { score: { type: 'number' } } } },
    });
  });
});
