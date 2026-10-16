import { randomBytes } from 'node:crypto';
import { currentCorrelation, withCorrelation } from './correlation.ts';

/** OpenTelemetry-shaped ids: 16-byte trace id, 8-byte span id, lower-case hex. */
export const newTraceId = (): string => randomBytes(16).toString('hex');
export const newSpanId = (): string => randomBytes(8).toString('hex');

export type SpanStatus = 'ok' | 'error';
export type AttributeValue = string | number | boolean;

/** A finished span as the exporter receives it (one trace per job; see {@link Tracer.startTrace}). */
export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, AttributeValue>;
  status: SpanStatus;
  error?: string;
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  setAttribute(key: string, value: AttributeValue): void;
  setAttributes(attributes: Record<string, AttributeValue>): void;
  recordError(error: unknown): void;
  end(): void;
}

/**
 * Where finished spans go. Production exports to Cloud Trace; tests use {@link MemoryExporter}. The
 * external exporter is always behind this interface (repo rule: every external call has a fake).
 */
export interface SpanExporter {
  export(span: SpanData): void;
}

/** Collects spans in memory for assertions in tests. */
export class MemoryExporter implements SpanExporter {
  readonly spans: SpanData[] = [];
  export(span: SpanData): void {
    this.spans.push(span);
  }
  clear(): void {
    this.spans.length = 0;
  }
  /** Finished spans belonging to one trace, in the order they ended. */
  trace(traceId: string): SpanData[] {
    return this.spans.filter((s) => s.traceId === traceId);
  }
}

/** Drops every span. The default until the app configures a real exporter at boot. */
export class NullExporter implements SpanExporter {
  export(): void {}
}

export interface SpanOptions {
  attributes?: Record<string, AttributeValue>;
  /** Start a brand-new trace instead of joining the one in scope. */
  newTrace?: boolean;
}

/**
 * A minimal tracer over {@link SpanExporter}. A span joins the trace in correlation scope (so one
 * job's agent run → LLM calls → tool calls → send share a trace id), or starts a new trace. Spans
 * run their body inside the span's correlation scope, so logs written during the span carry its ids.
 */
export class Tracer {
  constructor(
    private readonly exporter: SpanExporter,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private begin(name: string, opts: SpanOptions = {}): { span: Span; data: SpanData } {
    const ctx = currentCorrelation();
    const traceId = opts.newTrace || !ctx.traceId ? newTraceId() : ctx.traceId;
    const spanId = newSpanId();
    const data: SpanData = {
      traceId,
      spanId,
      parentSpanId: opts.newTrace ? undefined : ctx.spanId,
      name,
      startTime: this.now(),
      attributes: { ...opts.attributes },
      status: 'ok',
    };
    let ended = false;
    const span: Span = {
      traceId,
      spanId,
      setAttribute: (key, value) => {
        data.attributes[key] = value;
      },
      setAttributes: (attributes) => Object.assign(data.attributes, attributes),
      recordError: (error) => {
        data.status = 'error';
        data.error = error instanceof Error ? error.message : String(error);
      },
      end: () => {
        if (ended) return;
        ended = true;
        data.endTime = this.now();
        this.exporter.export(data);
      },
    };
    return { span, data };
  }

  /** Starts a span joined to the trace in scope (caller must `end()` it). */
  startSpan(name: string, opts?: SpanOptions): Span {
    return this.begin(name, opts).span;
  }

  /**
   * Runs `fn` inside a span and its correlation scope, ending the span (recording any error) when it
   * settles. Returns whatever `fn` returns.
   */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T> | T,
    opts?: SpanOptions,
  ): Promise<T> {
    const { span } = this.begin(name, opts);
    return withCorrelation({ traceId: span.traceId, spanId: span.spanId }, async () => {
      try {
        return await fn(span);
      } catch (error) {
        span.recordError(error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * One trace per job: starts a fresh trace (new trace id) and runs `fn` inside its root span. The
   * `ids` are added to the correlation scope for the whole trace.
   */
  startTrace<T>(
    name: string,
    ids: { workspaceId?: string; runId?: string; nodeId?: string },
    fn: (span: Span) => Promise<T> | T,
    attributes?: Record<string, AttributeValue>,
  ): Promise<T> {
    return withCorrelation(ids, () => this.withSpan(name, fn, { newTrace: true, attributes }));
  }
}

let current = new Tracer(new NullExporter());

/** Installs the process-wide tracer (called once at boot). */
export const configureTracing = (tracer: Tracer): void => {
  current = tracer;
};

/** The process-wide tracer. A no-op until {@link configureTracing} runs, so tests stay silent. */
export const tracer = (): Tracer => current;

/**
 * A Cloud Trace console link for a trace id — the PR 17 agent-graph popover links each node to its
 * trace. `projectId` is supplied by the caller (only `@sutra/config` reads the environment).
 */
export const traceLink = (projectId: string, traceId: string): string =>
  `https://console.cloud.google.com/traces/list?project=${encodeURIComponent(projectId)}&tid=${traceId}`;
