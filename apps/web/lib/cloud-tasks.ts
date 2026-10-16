import 'server-only';
import type { JobDispatcher, JobOptions, JobPayload } from '@sutra/agents';

export interface CloudTasksConfig {
  project: string;
  region: string;
  queue: string;
  /** Service account Cloud Tasks signs each job request's OIDC token with. */
  serviceAccount: string;
  /** Public base URL the task posts back to (`/api/jobs/<name>`). */
  appUrl: string;
  /** Bearer token for the Cloud Tasks API; defaults to the GCP metadata server. */
  token?: () => Promise<string>;
  fetch?: typeof fetch;
}

/** The access token of the Cloud Run service account, from the instance metadata server. */
async function metadataToken(): Promise<string> {
  const res = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!res.ok) throw new Error(`Metadata token request failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Cloud Tasks task names allow only `[A-Za-z0-9_-]`. */
const sanitize = (key: string) => key.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 500);

/**
 * The production job driver: each `enqueue` becomes an HTTP Cloud Task that posts back to
 * `/api/jobs/<name>` with an OIDC token and, when scheduled, a `scheduleTime`. The idempotency
 * `key` becomes the task name so a retried enqueue can't create a second task (a 409 is a success).
 * Every external call goes through the injectable `fetch`/`token`, so it is testable without GCP.
 */
export class CloudTasksDispatcher implements JobDispatcher {
  constructor(private readonly cfg: CloudTasksConfig) {}

  async dispatch(name: string, payload: JobPayload, opts?: JobOptions): Promise<void> {
    const { project, region, queue, serviceAccount, appUrl } = this.cfg;
    const doFetch = this.cfg.fetch ?? fetch;
    const token = await (this.cfg.token ?? metadataToken)();
    const parent = `projects/${project}/locations/${region}/queues/${queue}`;
    const url = `${appUrl}/api/jobs/${name}`;
    const task: Record<string, unknown> = {
      httpRequest: {
        httpMethod: 'POST',
        url,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(payload)).toString('base64'),
        oidcToken: { serviceAccountEmail: serviceAccount, audience: url },
      },
      ...(opts?.runAt && { scheduleTime: opts.runAt.toISOString() }),
      ...(opts?.key && { name: `${parent}/tasks/${sanitize(opts.key)}` }),
    };
    const res = await doFetch(`https://cloudtasks.googleapis.com/v2/${parent}/tasks`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ task }),
    });
    // 409 ALREADY_EXISTS means the idempotency key already enqueued this task: a success for us.
    if (!res.ok && res.status !== 409)
      throw new Error(`Cloud Tasks create failed: ${res.status} ${await res.text()}`);
  }
}
