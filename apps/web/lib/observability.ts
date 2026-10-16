import 'server-only';
import { env } from '@sutra/config';
import {
  ConsoleSink,
  configureLogging,
  configureMetrics,
  configureTracing,
  createLogger,
  type MetricEvent,
  Metrics,
  type MetricsSink,
  type SpanData,
  type SpanExporter,
  Tracer,
} from '@sutra/obs';

/**
 * Span exporter for Cloud Trace. At this volume the free tier is ample. We emit each finished span as
 * a structured JSON line (the shape Cloud Logging ingests and Cloud Trace can be fed from); this is
 * the seam where `@opentelemetry/exporter-trace-otlp-http` plugs in for native Cloud Trace export.
 */
class ConsoleSpanExporter implements SpanExporter {
  export(span: SpanData): void {
    process.stdout.write(`${JSON.stringify({ logType: 'trace', severity: 'INFO', ...span })}\n`);
  }
}

/** Metrics sink: one JSON line per measurement, for Cloud Monitoring log-based metrics. */
class ConsoleMetricsSink implements MetricsSink {
  record(event: MetricEvent): void {
    process.stdout.write(`${JSON.stringify({ logType: 'metric', severity: 'INFO', ...event })}\n`);
  }
}

let installed = false;

/**
 * Wires the process-wide observability sinks at boot (PR 18): structured `pino`-shaped JSON logs with
 * PII redaction → Cloud Logging, spans → Cloud Trace, metrics → Cloud Monitoring. Idempotent. Tests
 * never call this, so they keep the no-op defaults and stay silent.
 */
export function installObservability(): void {
  if (installed) return;
  installed = true;
  const level = env.NODE_ENV === 'production' ? 'info' : 'debug';
  configureLogging(
    createLogger({ sink: new ConsoleSink(), level, base: { service: 'sutra-web' } }),
  );
  configureTracing(new Tracer(new ConsoleSpanExporter()));
  configureMetrics(new Metrics(new ConsoleMetricsSink()));
}
