import { describe, expect, it } from 'vitest';
import { currentCorrelation } from './correlation.ts';
import { createLogger, MemorySink } from './logger.ts';
import { MemoryExporter, newSpanId, newTraceId, Tracer, traceLink } from './tracing.ts';

describe('ids', () => {
  it('are OTel-shaped hex', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('Tracer', () => {
  it('exports a finished span with timing and ok status', async () => {
    const exporter = new MemoryExporter();
    let t = 0;
    const tracer = new Tracer(exporter, () => (t += 5));
    await tracer.withSpan('work', (span) => span.setAttribute('n', 3));
    const [span] = exporter.spans;
    expect(span).toMatchObject({ name: 'work', status: 'ok', attributes: { n: 3 } });
    expect(span?.endTime).toBeGreaterThan(span?.startTime ?? 0);
  });

  it('records an error and rethrows', async () => {
    const exporter = new MemoryExporter();
    const tracer = new Tracer(exporter);
    await expect(
      tracer.withSpan('boom', () => {
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(exporter.spans[0]).toMatchObject({ status: 'error', error: 'nope' });
  });

  it('shares one trace id across a job and nests child spans', async () => {
    const exporter = new MemoryExporter();
    const tracer = new Tracer(exporter);
    const traceId = await tracer.startTrace('job', { workspaceId: 'ws', runId: 'r1' }, async () => {
      await tracer.withSpan('child', () => {});
      return currentCorrelation().traceId;
    });
    const spans = exporter.trace(traceId as string);
    expect(spans).toHaveLength(2);
    const root = spans.find((s) => s.name === 'job');
    const child = spans.find((s) => s.name === 'child');
    expect(child?.traceId).toBe(root?.traceId);
    expect(child?.parentSpanId).toBe(root?.spanId);
  });

  it('makes span correlation ids visible to logs written inside it', async () => {
    const sink = new MemorySink();
    const log = createLogger({ sink });
    const exporter = new MemoryExporter();
    const tracer = new Tracer(exporter);
    await tracer.startTrace('job', { workspaceId: 'ws' }, async () => {
      log.info('inside');
    });
    expect(sink.records[0]).toMatchObject({ workspaceId: 'ws' });
    expect(sink.records[0]?.traceId).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('traceLink', () => {
  it('builds a Cloud Trace console URL', () => {
    expect(traceLink('my-proj', 'abc123')).toBe(
      'https://console.cloud.google.com/traces/list?project=my-proj&tid=abc123',
    );
  });
});
