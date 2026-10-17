import type { ReadonlyContext } from '@google/adk';
import { describe, expect, it } from 'vitest';
import { type Agent, renderTemplate } from './agent.ts';
import { sequencePlanner, translator, variantWriter } from './agents/copywriter.ts';

const state = (values: Record<string, unknown> = {}) => ({
  get: (key: string) => values[key],
});

describe('renderTemplate', () => {
  it('fills a single-brace key from state', () => {
    expect(renderTemplate('Hello {name}', state({ name: 'Budi' }))).toBe('Hello Budi');
  });

  it('reads a nested path', () => {
    expect(renderTemplate('{workspace.name}', state({ workspace: { name: 'Acme' } }))).toBe('Acme');
  });

  it('JSON-encodes a non-string value', () => {
    expect(renderTemplate('{icp}', state({ icp: { country: 'ID' } }))).toBe('{"country":"ID"}');
  });

  it('renders an optional key as empty when missing', () => {
    expect(renderTemplate('A{note?}B', state())).toBe('AB');
  });

  it('throws on a missing required key', () => {
    expect(() => renderTemplate('{name}', state())).toThrow(/missing state "name"/);
  });

  // The production bug: email merge fields are written as `{{field}}` and must survive templating.
  it('leaves a double-brace merge field untouched', () => {
    expect(renderTemplate('Hi {{firstName}}', state())).toBe('Hi {{firstName}}');
  });

  it('leaves every merge field untouched without reading state', () => {
    const t = '{{firstName}} {{company}} {{personalization}} {{senderName}}';
    expect(renderTemplate(t, state())).toBe(t);
  });

  it('resolves a single-brace key while preserving adjacent merge fields', () => {
    expect(renderTemplate('Hi {{firstName}}, from {company}', state({ company: 'Acme' }))).toBe(
      'Hi {{firstName}}, from Acme',
    );
  });
});

// Guards the real copywriter instructions (the test suite otherwise stubs them), which embed
// `{{firstName}}` etc. and used to throw "Instruction references missing state" at render time.
describe('copywriter agent instructions render', () => {
  const ctx = { state: state() } as unknown as ReadonlyContext;
  const render = async (agent: Agent): Promise<string> => {
    const instruction = agent.instruction;
    return typeof instruction === 'function' ? await instruction(ctx) : instruction;
  };

  it('variantWriter renders without throwing and keeps its merge fields', async () => {
    const text = await render(variantWriter);
    expect(text).toContain('{{firstName}}');
    expect(text).toContain('{{personalization}}');
    expect(text).toContain('{{senderName}}');
  });

  it('translator renders without throwing and keeps its merge fields', async () => {
    const text = await render(translator);
    expect(text).toContain('{{company}}');
    expect(text).toContain('{{personalization}}');
  });

  it('sequencePlanner renders without throwing', async () => {
    await expect(render(sequencePlanner)).resolves.toBeTypeOf('string');
  });
});
