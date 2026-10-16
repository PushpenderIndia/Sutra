/**
 * `@sutra/agents` eval harness (PR 18). One runner, one framework, six datasets; offline against
 * fixtures and the deterministic rubric judge, with an LLM judge (`sutra-smart`) for the live runs.
 */
export { evaluateBandit } from './datasets/bandit.ts';
export { copilotCases, copilotTools, evaluateCopilot, READ_TOOLS } from './datasets/copilot.ts';
export { evaluateProfiler, profilerCases } from './datasets/profiler.ts';
export { evaluateReply } from './datasets/reply.ts';
export { evaluateScorer, scorerCases } from './datasets/scorer.ts';
export { evaluateVariant, variantPairs } from './datasets/variant.ts';
export {
  type EvalReport,
  type Grade,
  gradeSet,
  type Judge,
  type Metric,
  metric,
  type Rubric,
  reportPassed,
  rubricJudge,
} from './framework.ts';
export { EVALUATORS, renderReport, runEvals, writeReport } from './run.ts';
