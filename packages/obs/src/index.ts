/**
 * `@sutra/obs`: the observability seams (PR 18) — correlation IDs, structured logging with PII
 * redaction, tracing and metrics. Every transport is behind an interface with an in-memory fake, so
 * evals and tests run offline; production wires a JSON-lines sink to Cloud Logging, a span exporter
 * to Cloud Trace and metrics to Cloud Monitoring at boot. Built on the pipeline recorder, not instead
 * of it: the recorder keeps per-node tokens/cost in Mongo for the agent graph; this adds the trace and
 * log correlation that ties a run's spans and lines together.
 */
export {
  type Correlation,
  currentCorrelation,
  withCorrelation,
} from './correlation.ts';
export {
  ConsoleSink,
  configureLogging,
  createLogger,
  type Fields,
  LEVELS,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  type LogRecord,
  type LogSink,
  log,
  MemorySink,
  NullSink,
} from './logger.ts';
export {
  configureMetrics,
  type Labels,
  MemoryMetricsSink,
  type MetricEvent,
  Metrics,
  type MetricsSink,
  metrics,
  NullMetricsSink,
} from './metrics.ts';
export {
  EMAIL_KEYS,
  MASK,
  maskEmail,
  redact,
  SENSITIVE_KEYS,
} from './redact.ts';
export {
  type AttributeValue,
  configureTracing,
  MemoryExporter,
  NullExporter,
  newSpanId,
  newTraceId,
  type Span,
  type SpanData,
  type SpanExporter,
  type SpanOptions,
  type SpanStatus,
  Tracer,
  traceLink,
  tracer,
} from './tracing.ts';
