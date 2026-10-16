/**
 * A tiny metrics facade over the token/cost/tool-call figures the pipeline recorder already keeps
 * (PR 18 builds on that seam rather than replacing it). Counters and a value recorder are enough to
 * surface rates and totals; the sink is injected so production can forward to Cloud Monitoring and
 * tests assert against {@link MemoryMetricsSink}.
 */

export type Labels = Record<string, string>;

export interface MetricEvent {
  name: string;
  kind: 'counter' | 'value';
  value: number;
  labels: Labels;
  time: number;
}

export interface MetricsSink {
  record(event: MetricEvent): void;
}

/** Keeps every event, with aggregate helpers, for assertions in tests. */
export class MemoryMetricsSink implements MetricsSink {
  readonly events: MetricEvent[] = [];
  record(event: MetricEvent): void {
    this.events.push(event);
  }
  clear(): void {
    this.events.length = 0;
  }
  /** Summed value of a counter (optionally filtered by a label subset). */
  total(name: string, labels: Labels = {}): number {
    return this.events
      .filter((e) => e.name === name && Object.entries(labels).every(([k, v]) => e.labels[k] === v))
      .reduce((sum, e) => sum + e.value, 0);
  }
}

export class NullMetricsSink implements MetricsSink {
  record(): void {}
}

export class Metrics {
  constructor(
    private readonly sink: MetricsSink,
    private readonly now: () => number = () => Date.now(),
  ) {}
  /** Adds `value` (default 1) to a counter. */
  increment(name: string, labels: Labels = {}, value = 1): void {
    this.sink.record({ name, kind: 'counter', value, labels, time: this.now() });
  }
  /** Records a single measurement (a duration, a token count, a cost). */
  observe(name: string, value: number, labels: Labels = {}): void {
    this.sink.record({ name, kind: 'value', value, labels, time: this.now() });
  }
}

let current = new Metrics(new NullMetricsSink());

export const configureMetrics = (metrics: Metrics): void => {
  current = metrics;
};

/** The process-wide metrics facade. A no-op until {@link configureMetrics} runs. */
export const metrics = (): Metrics => current;
