/**
 * The seam between "do this in the background" and how it runs. Handlers are registered by
 * name; a dispatcher delivers a payload to one. The in-process dispatcher runs the handler
 * before resolving (`JOBS_DRIVER=inline`); PR 13's Cloud Tasks driver (`setJobDispatcher`) posts
 * an HTTP task with an OIDC token and a `scheduleTime` instead.
 */
export type JobPayload = Record<string, unknown>;
export type JobHandler = (payload: JobPayload) => Promise<void>;

export interface JobOptions {
  /**
   * Run no earlier than this time. The Cloud Tasks driver maps it to `scheduleTime`; the inline
   * driver runs immediately (the enrollment's `nextRunAt` and the `maintenance` sweep make future
   * steps deterministic in dev, so an early inline run is a harmless `wait`).
   */
  runAt?: Date;
  /** Idempotency / dedupe key, used as the Cloud Tasks task name so a retry can't double-enqueue. */
  key?: string;
}

export interface JobDispatcher {
  dispatch(name: string, payload: JobPayload, opts?: JobOptions): Promise<void>;
}

const handlers = new Map<string, JobHandler>();

export function defineJob(name: string, handler: JobHandler) {
  handlers.set(name, handler);
}

/** Runs a registered job now. Job endpoints (the `/api/jobs/[name]` route) call this. */
export function handleJob(name: string, payload: JobPayload) {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`No job handler registered for "${name}"`);
  return handler(payload);
}

/** Whether a handler is registered (so a caller can no-op when running outside the web app). */
export const hasJob = (name: string) => handlers.has(name);

export const inProcessDispatcher: JobDispatcher = {
  dispatch: (name, payload) => handleJob(name, payload),
};

let dispatcher = inProcessDispatcher;
export const setJobDispatcher = (next: JobDispatcher) => {
  dispatcher = next;
};

export const dispatch = (name: string, payload: JobPayload, opts?: JobOptions) =>
  dispatcher.dispatch(name, payload, opts);

/** Schedules a background job by name (typed drivers verify the payload at the route). */
export const enqueue = (name: string, payload: JobPayload, opts?: JobOptions) =>
  dispatch(name, payload, opts);
