import { id } from '@sutra/domain';
import { z } from 'zod';
import { route } from '@/lib/action';
import { loadRunChanges } from '@/lib/data/pipeline';

/** The agent graph's poll: nodes of the run changed since `after` (all of them without it). */
export const GET = route(
  z.object({ runId: z.union([id, z.literal('latest')]), after: z.iso.datetime().optional() }),
  ({ workspaceId }, { runId, after }) =>
    loadRunChanges(workspaceId, runId, after ? new Date(after) : undefined),
);
