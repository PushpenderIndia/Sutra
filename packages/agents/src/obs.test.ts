import { newId } from '@sutra/db';
import {
  configureLogging,
  configureMetrics,
  configureTracing,
  createLogger,
  MemoryExporter,
  MemoryMetricsSink,
  MemorySink,
  Metrics,
  NullExporter,
  NullSink,
  Tracer,
  withCorrelation,
} from '@sutra/obs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completion, mockProxy } from '../test/mock-proxy.ts';
import { defineAgent } from './agent.ts';
import { runAgent } from './run.ts';

const proxy = await mockProxy();

/** Install in-memory observability fakes; restore the no-op defaults after each test. */
const exporter = new MemoryExporter();
const logs = new MemorySink();
const metricEvents = new MemoryMetricsSink();

describe('runAgent observability wiring', () => {
  beforeEach(() => {
    exporter.clear();
    logs.clear();
    metricEvents.clear();
    configureTracing(new Tracer(exporter));
    configureLogging(createLogger({ sink: logs, level: 'debug' }));
    configureMetrics(new Metrics(metricEvents));
  });
  afterEach(() => {
    configureTracing(new Tracer(new NullExporter()));
    configureLogging(createLogger({ sink: new NullSink() }));
    configureMetrics(new Metrics(new MemoryMetricsSink()));
  });

  it('emits an agent span, token/cost metrics and a correlated log line', async () => {
    const agent = defineAgent({ name: 'obsAgent', model: proxy.model(), instruction: 'Chat.' });
    proxy.reply({ json: completion('hi', { tokens: [12, 8] }), cost: 0.002 });

    await withCorrelation({ workspaceId: 'ws', runId: 'run1' }, () =>
      runAgent({ agent, workspaceId: newId(), sessionKey: `s:${newId()}`, input: 'go' }),
    );

    const span = exporter.spans.find((s) => s.name === 'agent:obsAgent');
    expect(span).toBeDefined();
    expect(span?.status).toBe('ok');
    expect(span?.attributes).toMatchObject({ 'agent.name': 'obsAgent', 'llm.model': 'sutra-fast' });
    expect(span?.attributes['llm.tokens_in']).toBe(12);

    expect(metricEvents.total('llm.tokens', { agent: 'obsAgent', model: 'sutra-fast' })).toBe(20);
    expect(metricEvents.total('llm.cost_usd')).toBeCloseTo(0.002);

    const line = logs.records.find((r) => r.msg === 'agent.run');
    expect(line).toMatchObject({ agent: 'obsAgent', workspaceId: 'ws', runId: 'run1' });
    expect(line?.traceId).toMatch(/^[0-9a-f]{32}$/);
  });
});
