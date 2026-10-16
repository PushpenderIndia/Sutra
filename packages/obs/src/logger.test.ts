import { describe, expect, it } from 'vitest';
import { withCorrelation } from './correlation.ts';
import { ConsoleSink, createLogger, MemorySink } from './logger.ts';

const fixedNow = () => new Date('2026-10-17T00:00:00.000Z');

describe('createLogger', () => {
  it('writes a structured record with level, severity, time and msg', () => {
    const sink = new MemorySink();
    const log = createLogger({ sink, now: fixedNow });
    log.info('hello', { a: 1 });
    expect(sink.records[0]).toEqual({
      level: 'info',
      severity: 'INFO',
      time: '2026-10-17T00:00:00.000Z',
      msg: 'hello',
      a: 1,
    });
  });

  it('drops lines below the threshold', () => {
    const sink = new MemorySink();
    const log = createLogger({ sink, level: 'warn' });
    log.info('ignored');
    log.error('kept');
    expect(sink.records.map((r) => r.msg)).toEqual(['kept']);
  });

  it('stamps the correlation ids in scope on every line', () => {
    const sink = new MemorySink();
    const log = createLogger({ sink });
    withCorrelation({ workspaceId: 'ws', runId: 'r1', traceId: 'abc' }, () => {
      log.info('in scope');
    });
    expect(sink.records[0]).toMatchObject({ workspaceId: 'ws', runId: 'r1', traceId: 'abc' });
  });

  it('redacts PII in fields', () => {
    const sink = new MemorySink();
    const log = createLogger({ sink });
    log.info('sent', { to: 'lead@acme.com', apiKey: 'sk-secret' });
    expect(sink.records[0]).toMatchObject({ to: 'l***@acme.com', apiKey: '[redacted]' });
  });

  it('merges base and child fields', () => {
    const sink = new MemorySink();
    const log = createLogger({ sink, base: { component: 'mail' } });
    log.child({ job: 'deliver' }).info('tick');
    expect(sink.records[0]).toMatchObject({ component: 'mail', job: 'deliver' });
  });

  it('ConsoleSink emits one JSON line per record', () => {
    const lines: string[] = [];
    const log = createLogger({ sink: new ConsoleSink((l) => lines.push(l)), now: fixedNow });
    log.warn('careful');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ severity: 'WARNING', msg: 'careful' });
  });
});
