import { enrollApprovedCampaigns } from './campaign/enroll.ts';
import { runCopywriter } from './copywriter/run.ts';
import { runEnricher } from './enricher/run.ts';
import { definePipeline } from './pipeline/define.ts';
import { runProfiler } from './profiler/run.ts';
import { enabledProspectorSources, runProspectorSource } from './prospector/run.ts';

/**
 * The human checkpoint-1 node id (`you confirm profile`); resumed when the user confirms.
 * Matches `MAIN_TOPOLOGY` and the demo seed so the agent graph lines up with the live run.
 */
export const CHECKPOINT_PROFILE = 'checkpoint1';

/** The human checkpoint-2 node id (`you approve campaign`); resumed when the campaign is approved. */
export const CHECKPOINT_CAMPAIGN = 'checkpoint2';

/**
 * The executable autonomous flow. The same definition drives execution (`runPipeline`) and,
 * together with `MAIN_TOPOLOGY`, the live agent graph (PR 17). Later PRs add enrichment, campaigns
 * and sending; PR 07 delivers the profiler and checkpoint 1, PR 08 the multi-source prospector,
 * PR 09 the enricher and scorer.
 */
export const mainPipeline = definePipeline(
  {
    orchestrator: {
      label: 'Orchestrator',
      children: ['profiler', 'checkpoint1', 'prospector', 'enricher', 'copywriter', 'sender'],
    },
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
    enricher: {
      label: 'Enricher & Scorer',
      after: ['prospector'],
      // Per company: contact finder (for any still without contacts) → researcher → scorer, within
      // a concurrency limit and a per-run budget. A deterministic pre-filter disqualifies some with
      // no LLM call; the rest get a blended score (0.6 LLM + 0.4 rules).
      children: ['contactFinder', 'researcher', 'scorer'],
      run: runEnricher,
    },
    copywriter: {
      label: 'Copywriter',
      after: ['enricher'],
      // Per persona: plan the sequence → write two A/B variants per step → deterministic quality
      // gate (one regeneration on failure) → translate each template into the contacts' locales,
      // saving one draft campaign per persona for checkpoint 2.
      children: ['sequencePlanner', 'variantWriter', 'qualityGate'],
      run: runCopywriter,
    },
    checkpoint2: {
      label: 'You approve campaign',
      kind: 'human',
      after: ['copywriter'],
    },
    sender: {
      label: 'Sender',
      after: ['checkpoint2'],
      // After approval: enrol each approved campaign's audience and schedule their first step inside
      // the contact's send window. Each step then flows through compliance → scheduler → Gmail.
      children: ['compliance', 'scheduler', 'gmail'],
      run: async ({ workspaceId }) => {
        const enrolled = await enrollApprovedCampaigns(workspaceId);
        return { summary: enrolled ? `${enrolled} contacts enrolled` : 'No one to enrol' };
      },
    },
  },
  { name: 'main' },
);
