/**
 * The seam between "do this in the background" and how it runs. Handlers are registered by
 * name; a dispatcher delivers a payload to one. The in-process dispatcher runs the handler
 * before resolving (`JOBS_DRIVER=inline`); PR 13 installs a Cloud Tasks one with `setJobDispatcher`.
 */
export type JobPayload = Record<string, unknown>;
export type JobHandler = (payload: JobPayload) => Promise<void>;
export interface JobDispatcher {
  dispatch(name: string, payload: JobPayload): Promise<void>;
}

const handlers = new Map<string, JobHandler>();

export function defineJob(name: string, handler: JobHandler) {
  handlers.set(name, handler);
}

/** Runs a registered job now. Job endpoints (PR 13) call this with the delivered payload. */
export function handleJob(name: string, payload: JobPayload) {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`No job handler registered for "${name}"`);
  return handler(payload);
}

export const inProcessDispatcher: JobDispatcher = { dispatch: handleJob };

let dispatcher = inProcessDispatcher;
export const setJobDispatcher = (next: JobDispatcher) => {
  dispatcher = next;
};
export const dispatch = (name: string, payload: JobPayload) => dispatcher.dispatch(name, payload);
