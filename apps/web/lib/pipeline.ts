import 'server-only';
import { getPipeline, MAIN_TOPOLOGY, type Pipeline, topologyOf } from '@sutra/agents';

/** The registered main pipeline, if this build defines one. */
export function mainPipeline(): Pipeline | undefined {
  try {
    return getPipeline('main');
  } catch {
    return undefined;
  }
}

/** What the agent graph draws: the main pipeline's topology, else the planned one. */
export const graphTopology = () => {
  const pipeline = mainPipeline();
  return pipeline ? topologyOf(pipeline) : MAIN_TOPOLOGY;
};
