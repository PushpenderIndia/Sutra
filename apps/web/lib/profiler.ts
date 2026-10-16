import 'server-only';
import { runPipeline } from '@sutra/agents';
import { env } from '@sutra/config';
import type { Id } from '@sutra/domain';
import { after } from 'next/server';
import { mainPipeline } from '@/lib/pipeline';

/**
 * Kicks off the profiler pipeline for a workspace whose `website` is already saved in settings.
 * It crawls and researches the site, writes the profile and ICP, then pauses at checkpoint 1 on
 * the Business tab. Runs after the response (`after()`) so onboarding redirects immediately; the
 * Business tab polls for progress. No-op under test, where the profiler is exercised directly.
 */
export async function startProfiler(workspaceId: Id): Promise<void> {
  if (env.NODE_ENV === 'test') return;
  const pipeline = mainPipeline();
  if (!pipeline) return;
  after(() => runPipeline(pipeline, workspaceId));
}
