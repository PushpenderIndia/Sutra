'use server';
import { runPipeline } from '@sutra/agents';
import { audit } from '@sutra/db';
import { after } from 'next/server';
import { z } from 'zod';
import { AppError, action } from '@/lib/action';
import { mainPipeline } from '@/lib/pipeline';

/**
 * "Re-run from here" in the agent graph: the node and everything downstream recompute in the
 * background (upstream results are kept). Owners and admins only.
 */
export const rerunFrom = action(
  z.object({ nodeId: z.string().min(1) }),
  async ({ workspaceId, user }, { nodeId }) => {
    const pipeline = mainPipeline();
    if (!pipeline?.order.includes(nodeId) || pipeline.nodes[nodeId]?.kind === 'human')
      throw new AppError('INVALID', `Cannot re-run from "${nodeId}"`);
    await audit(workspaceId, { kind: 'user', id: user.id }, 'pipeline.rerun', {
      entity: 'pipeline_runs',
      data: { from: nodeId },
    });
    after(() => runPipeline(pipeline, workspaceId, nodeId));
    return { nodeId };
  },
  { role: 'admin' },
);
