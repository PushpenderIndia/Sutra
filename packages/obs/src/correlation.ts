import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The correlation IDs stamped on every span and log line (PR 18). One trace per job carries these
 * through the agent run, LLM calls, tool calls and the Gmail send, so any log or span can be joined
 * back to the workspace, pipeline run, node, contact and message it belongs to.
 */
export interface Correlation {
  workspaceId?: string;
  runId?: string;
  nodeId?: string;
  contactId?: string;
  messageId?: string;
  /** The OpenTelemetry-shaped trace id (16 bytes, hex) of the enclosing job. */
  traceId?: string;
  /** The current span's id (8 bytes, hex). */
  spanId?: string;
}

const storage = new AsyncLocalStorage<Correlation>();

/** Drops `undefined`/`null` keys so a child scope never blanks out a parent's id. */
const clean = (ids: Correlation): Correlation =>
  Object.fromEntries(
    Object.entries(ids).filter(([, v]) => v !== undefined && v !== null),
  ) as Correlation;

/** The correlation IDs in scope right now (empty outside any `withCorrelation`). */
export const currentCorrelation = (): Correlation => storage.getStore() ?? {};

/**
 * Runs `fn` with `ids` merged onto the correlation IDs already in scope. Nesting is additive: a
 * child may add a `nodeId` or `contactId` without losing the enclosing `workspaceId`/`runId`.
 */
export function withCorrelation<T>(ids: Correlation, fn: () => T): T {
  const merged = { ...currentCorrelation(), ...clean(ids) };
  return storage.run(merged, fn);
}
