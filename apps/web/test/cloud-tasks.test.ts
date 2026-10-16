import { describe, expect, it } from 'vitest';
import { CloudTasksDispatcher } from '@/lib/cloud-tasks';

function fakeFetch(status = 200, body = '') {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const config = (fetchFn: typeof fetch) => ({
  project: 'proj',
  region: 'us-central1',
  queue: 'sutra-jobs',
  serviceAccount: 'jobs@proj.iam.gserviceaccount.com',
  appUrl: 'https://app.example',
  token: async () => 'access-token',
  fetch: fetchFn,
});

/** The task object posted to the Cloud Tasks API. */
function postedTask(calls: { url: string; init: RequestInit }[]) {
  const first = calls[0];
  if (!first) throw new Error('No Cloud Tasks request was made');
  const body = JSON.parse(String(first.init.body)) as {
    task: {
      httpRequest: { url: string; body: string; oidcToken: { serviceAccountEmail: string } };
      scheduleTime?: string;
      name?: string;
    };
  };
  return body.task;
}

describe('CloudTasksDispatcher', () => {
  it('creates an OIDC-authenticated HTTP task that posts the payload to the job route', async () => {
    const { fn, calls } = fakeFetch();
    await new CloudTasksDispatcher(config(fn)).dispatch('deliver', { messageId: 'm1' });

    const first = calls[0];
    expect(first?.url).toBe(
      'https://cloudtasks.googleapis.com/v2/projects/proj/locations/us-central1/queues/sutra-jobs/tasks',
    );
    expect((first?.init.headers as Record<string, string>)?.authorization).toBe(
      'Bearer access-token',
    );
    const task = postedTask(calls);
    expect(task.httpRequest.url).toBe('https://app.example/api/jobs/deliver');
    expect(task.httpRequest.oidcToken.serviceAccountEmail).toBe(
      'jobs@proj.iam.gserviceaccount.com',
    );
    expect(JSON.parse(Buffer.from(task.httpRequest.body, 'base64').toString('utf8'))).toEqual({
      messageId: 'm1',
    });
    expect(task.scheduleTime).toBeUndefined();
    expect(task.name).toBeUndefined();
  });

  it('passes a scheduleTime and an idempotency task name', async () => {
    const { fn, calls } = fakeFetch();
    const runAt = new Date('2026-10-20T01:00:00.000Z');
    await new CloudTasksDispatcher(config(fn)).dispatch(
      'campaign.step',
      { enrollmentId: 'e1' },
      { runAt, key: 'enr:e1/step:2' },
    );
    const task = postedTask(calls);
    expect(task.scheduleTime).toBe(runAt.toISOString());
    expect(task.name).toBe(
      'projects/proj/locations/us-central1/queues/sutra-jobs/tasks/enr_e1_step_2',
    );
  });

  it('treats a duplicate task (409 ALREADY_EXISTS) as success but throws on other errors', async () => {
    const dup = fakeFetch(409);
    await expect(
      new CloudTasksDispatcher(config(dup.fn)).dispatch('deliver', {}, { key: 'dupe' }),
    ).resolves.toBeUndefined();

    const err = fakeFetch(500, 'boom');
    await expect(new CloudTasksDispatcher(config(err.fn)).dispatch('deliver', {})).rejects.toThrow(
      /Cloud Tasks create failed: 500/,
    );
  });
});
