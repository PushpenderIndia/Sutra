import { definePipeline } from './pipeline/define.ts';
import { runProfiler } from './profiler/run.ts';
import { enabledProspectorSources, runProspectorSource } from './prospector/run.ts';

/**
 * The human checkpoint-1 node id (`you confirm profile`); resumed when the user confirms.
 * Matches `MAIN_TOPOLOGY` and the demo seed so the agent graph lines up with the live run.
 */
export const CHECKPOINT_PROFILE = 'checkpoint1';

/**
 * The executable autonomous flow. The same definition drives execution (`runPipeline`) and,
 * together with `MAIN_TOPOLOGY`, the live agent graph (PR 17). Later PRs add enrichment, campaigns
 * and sending; PR 07 delivers the profiler and checkpoint 1, PR 08 the multi-source prospector.
 */
export const mainPipeline = definePipeline(
  {
    orchestrator: { label: 'Orchestrator', children: ['profiler', 'checkpoint1', 'prospector'] },
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
    prospector: {
      label: 'Prospector',
      after: ['checkpoint1'],
      // One child per enabled lead source; each streams companies/contacts into normalise → dedupe
      // → upsert, and runs the contact finder for free-source companies without contacts.
      fanOut: enabledProspectorSources,
      run: runProspectorSource,
    },
  },
  { name: 'main' },
);
