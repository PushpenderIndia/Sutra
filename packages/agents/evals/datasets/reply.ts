import { replyEvalSet } from '../../src/reply/fixtures.ts';
import { heuristicAnalyze } from '../../src/reply/heuristic.ts';
import { type EvalReport, metric, ratio } from '../framework.ts';

/**
 * Reply-analyst eval. PR 14 already shipped the 40-case / 6-language labelled set
 * (`src/reply/fixtures.ts`) and an offline `eval.test.ts`; PR 18 folds that set into the one eval
 * harness rather than duplicating it. The offline metric scores the deterministic multilingual
 * analyser (`heuristicAnalyze`); `pnpm eval replyAnalyst --live` scores the `replyAnalyst` LLM against
 * the same labels. Target: intent accuracy ≥ 90% (the PR 14 acceptance criterion).
 */
export function evaluateReply(): EvalReport {
  const correct = replyEvalSet.filter(
    (c) => heuristicAnalyze(c.reply, c.locale).intent === c.expected,
  );
  const accuracy = ratio(correct.length, replyEvalSet.length);
  const languages = new Set(replyEvalSet.map((c) => c.locale)).size;
  return {
    agent: 'replyAnalyst',
    description: `${replyEvalSet.length} replies across ${languages} languages, expected intent`,
    cases: replyEvalSet.length,
    metrics: [
      metric('intent accuracy', accuracy, 0.9, {
        note: `${correct.length}/${replyEvalSet.length} correct`,
      }),
    ],
  };
}
