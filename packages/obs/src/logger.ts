import { currentCorrelation } from './correlation.ts';
import { redact } from './redact.ts';

/** Log levels, ordered. Mapped to a Cloud Logging `severity` on the way out. */
export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

const SEVERITY: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
};

export type Fields = Record<string, unknown>;

/** One structured log line, after correlation IDs are merged and PII is redacted. */
export interface LogRecord extends Fields {
  level: LogLevel;
  severity: string;
  time: string;
  msg: string;
}

/**
 * Where log records go. Production uses {@link ConsoleSink} (JSON lines → Cloud Logging via stdout);
 * tests use {@link MemorySink}. The external sink is always behind this interface (repo rule: every
 * external call has a fake), so nothing in the app writes to a transport directly.
 */
export interface LogSink {
  write(record: LogRecord): void;
}

/** Collects records in memory for assertions in tests. */
export class MemorySink implements LogSink {
  readonly records: LogRecord[] = [];
  write(record: LogRecord): void {
    this.records.push(record);
  }
  clear(): void {
    this.records.length = 0;
  }
}

/** Drops everything. The default until the app configures a real sink at boot. */
export class NullSink implements LogSink {
  write(): void {}
}

/**
 * One JSON object per line on stdout (pino's shape), which Cloud Logging ingests and parses into
 * structured fields with the right `severity`. A newline-delimited JSON stream, never pretty-printed.
 */
export class ConsoleSink implements LogSink {
  constructor(private readonly out: (line: string) => void = (l) => process.stdout.write(l)) {}
  write(record: LogRecord): void {
    this.out(`${JSON.stringify(record)}\n`);
  }
}

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  /** A logger that merges `fields` into every line it writes. */
  child(fields: Fields): Logger;
}

export interface LoggerOptions {
  sink: LogSink;
  /** Lines below this level are dropped. Defaults to `info`. */
  level?: LogLevel;
  /** Fields merged into every line (a component name, say). */
  base?: Fields;
  /** Clock seam for deterministic tests. */
  now?: () => Date;
}

/**
 * A structured logger. Every line carries the correlation IDs in scope (workspaceId, runId, nodeId,
 * contactId, messageId, traceId, spanId), the `base`/`child` fields and the call's fields, with PII
 * redacted. The sink is injected, so tests assert against a {@link MemorySink} and nothing hits a
 * real transport.
 */
export function createLogger(opts: LoggerOptions): Logger {
  const threshold = LEVELS[opts.level ?? 'info'];
  const now = opts.now ?? (() => new Date());

  const make = (bound: Fields): Logger => {
    const emit = (level: LogLevel, msg: string, fields?: Fields) => {
      if (LEVELS[level] < threshold) return;
      const merged = { ...bound, ...currentCorrelation(), ...fields };
      const record: LogRecord = {
        ...(redact(merged) as Fields),
        level,
        severity: SEVERITY[level],
        time: now().toISOString(),
        msg,
      };
      opts.sink.write(record);
    };
    return {
      debug: (msg, fields) => emit('debug', msg, fields),
      info: (msg, fields) => emit('info', msg, fields),
      warn: (msg, fields) => emit('warn', msg, fields),
      error: (msg, fields) => emit('error', msg, fields),
      child: (fields) => make({ ...bound, ...fields }),
    };
  };
  return make(opts.base ?? {});
}

let current: Logger = createLogger({ sink: new NullSink() });

/** Installs the process-wide logger (called once at boot). */
export const configureLogging = (logger: Logger): void => {
  current = logger;
};

/** The process-wide logger. A no-op until {@link configureLogging} runs, so tests stay silent. */
export const log = (): Logger => current;
