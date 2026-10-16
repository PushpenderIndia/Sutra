import { definePipeline } from './pipeline/define.ts';
import { runProfiler } from './profiler/run.ts';

/**
 * The human checkpoint-1 node id (`you confirm profile`); resumed when the user confirms.
 * Matches `MAIN_TOPOLOGY` and the demo seed so the agent graph lines up with the live run.
 */
export const CHECKPOINT_PROFILE = 'checkpoint1';

/**
 * The executable autonomous flow. The same definition drives execution (`runPipeline`) and,
 * together with `MAIN_TOPOLOGY`, the live agent graph (PR 17). Later PRs add prospecting,
 * enrichment, campaigns and sending; PR 07 delivers the profiler and checkpoint 1.
 */
export const mainPipeline = definePipeline(
  {
    orchestrator: { label: 'Orchestrator', children: ['profiler', 'checkpoint1'] },
    profiler: {
      label: 'Business Profiler',
      after: ['orchestrator'],
      children: ['crawler', 'webResearch', 'profileWriter', 'icpBuilder'],
      run: runProfiler,
    },
    checkpoint1: {
      label: 'You confirm profile',
      kind: 'human',
      after: ['profiler'],
    },
  },
  { name: 'main' },
);
