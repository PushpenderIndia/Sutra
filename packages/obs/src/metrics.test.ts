import { describe, expect, it } from 'vitest';
import { MemoryMetricsSink, Metrics } from './metrics.ts';

describe('Metrics', () => {
  it('sums counters, optionally by label', () => {
    const sink = new MemoryMetricsSink();
    const m = new Metrics(sink);
    m.increment('sends', { workspaceId: 'a' });
    m.increment('sends', { workspaceId: 'a' }, 2);
    m.increment('sends', { workspaceId: 'b' });
    expect(sink.total('sends')).toBe(4);
    expect(sink.total('sends', { workspaceId: 'a' })).toBe(3);
  });

  it('records individual observations', () => {
    const sink = new MemoryMetricsSink();
    const m = new Metrics(sink);
    m.observe('llm.tokens', 150, { model: 'sutra-fast' });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({ kind: 'value', value: 150, name: 'llm.tokens' });
  });
});
