import 'server-only';
// Importing the agents barrel registers the pipeline's own jobs (`pipeline.node`, `campaign.step`).
import {
  defineJob,
  enqueue,
  handleJob,
  type JobPayload,
  runTrigger,
  setJobDispatcher,
  sweepDueEnrollments,
} from '@sutra/agents';
import { env } from '@sutra/config';
import { Campaigns, Enrollments, Messages, retentionSweep } from '@sutra/db';
import { deliver, onReply, renewWatches } from '@sutra/mail';
import { CloudTasksDispatcher } from './cloud-tasks';
import { mainPipeline } from './pipeline';

/**
 * One place where every background job is registered and the driver chosen. The pipeline engine and
 * the campaign engine register their own handlers on import; this file adds `deliver` and
 * `maintenance`, then installs the Cloud Tasks driver in production.
 */

type Deliver = { workspaceId: string; messageId: string };

defineJob('deliver', async (payload: JobPayload) => {
  const { workspaceId, messageId } = payload as Deliver;
  const result = await deliver(workspaceId, messageId);
  // A temporary block reschedules the send. Only the scheduling driver re-enqueues it; inline dev
  // relies on the `maintenance` sweep so a closed send window can't spin a tight retry loop.
  if (result.status === 'deferred' && env.JOBS_DRIVER === 'cloud-tasks')
    await enqueue('deliver', { workspaceId, messageId }, { runAt: result.retryAt });
});

/**
 * The single cron job (keeps Cloud Scheduler inside its 3-job free tier): renews Gmail watches,
 * re-enqueues due campaign steps and deferred sends (restart-safe recovery) and runs the retention
 * sweep per workspace. Best-effort: one workspace's failure never stops the rest.
 */
export async function maintenance(now = new Date()): Promise<void> {
  await renewWatches(now).catch(() => {});

  const dueEnrollments = (await Enrollments.col().distinct('workspaceId', {
    status: 'active',
    nextRunAt: { $lte: now },
  })) as string[];
  for (const ws of dueEnrollments) await sweepDueEnrollments(ws, now).catch(() => {});

  const dueMessages = await Messages.col()
    .find({ direction: 'outbound', status: 'queued', scheduledAt: { $lte: now } })
    .project({ workspaceId: 1, _id: 1 })
    .toArray();
  for (const m of dueMessages)
    await enqueue('deliver', { workspaceId: m.workspaceId, messageId: m._id }).catch(() => {});

  const workspaces = (await Enrollments.col().distinct('workspaceId', {})) as string[];
  for (const ws of workspaces) await retentionSweep(ws, now).catch(() => {});

  // Run the A/B optimizer once per cron for every workspace with a live campaign: retire losers,
  // record insights and propose challengers into the approval queue (it activates nothing itself).
  const pipeline = mainPipeline();
  if (pipeline) {
    const liveWorkspaces = (await Campaigns.col().distinct('workspaceId', {
      status: { $in: ['running', 'paused'] },
    })) as string[];
    for (const ws of liveWorkspaces)
      await runTrigger(pipeline, ws, 'optimizer').catch((error) =>
        console.error('optimizer', error),
      );
  }
}
defineJob('maintenance', () => maintenance());

let installed = false;
/** Selects the job driver at boot. Inline (default) runs in-process; prod posts Cloud Tasks. */
export function installJobs() {
  if (installed) return;
  installed = true;

  // Each new reply (from Gmail push or the FAKE_MAIL simulator) runs the reply-analyst trigger node,
  // so it understands the reply and runs the action map, and the live agent graph flashes the node.
  const pipeline = mainPipeline();
  if (pipeline)
    onReply((reply) =>
      runTrigger(pipeline, reply.workspaceId, 'replyAnalyst', reply._id).catch((error) =>
        console.error('reply analyst', error),
      ),
    );

  if (env.JOBS_DRIVER === 'cloud-tasks')
    setJobDispatcher(
      new CloudTasksDispatcher({
        project: env.GCP_PROJECT_ID,
        region: env.GCP_REGION,
        queue: env.CLOUD_TASKS_QUEUE ?? 'sutra-jobs',
        serviceAccount: env.JOBS_OIDC_SERVICE_ACCOUNT ?? '',
        appUrl: env.APP_URL,
      }),
    );
}

export { enqueue, handleJob };
