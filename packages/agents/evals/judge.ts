import { z } from 'zod';
import { defineAgent } from '../src/agent.ts';
import { runAgent } from '../src/run.ts';
import type { Grade, Judge, Rubric } from './framework.ts';

/**
 * The production LLM judge (`sutra-smart`), used by `pnpm eval` to grade the softer rubric criteria
 * that a deterministic check can't ("sensible ICP", "correct register", "reads as personalised").
 * CI never calls this — it uses the deterministic `rubricJudge` so evals stay offline and free. The
 * grading model is itself an ADK agent, so it runs through the same safety and recorder seams.
 */

const gradeSchema = z.object({
  criteria: z.array(z.object({ id: z.string(), pass: z.boolean(), reason: z.string() })),
});

export const JUDGE_NAME = 'evalJudge';

const judgeAgent = defineAgent({
  name: JUDGE_NAME,
  model: 'sutra-smart',
  instruction: [
    'You are a strict evaluation judge. Given an output and a rubric of yes/no criteria, decide whether each criterion is met.',
    'Judge only what the rubric asks. Return JSON matching the schema: one entry per criterion id, with a boolean pass and a one-line reason.',
  ],
  output: gradeSchema,
  temperature: 0,
});

/**
 * An {@link Judge} backed by the LLM. `workspaceId` scopes the judge's session; it is awaited per
 * output, so the live eval runner calls it with a concurrency limit. Offline evals use `rubricJudge`.
 */
export function llmJudge(workspaceId: string): Judge & {
  gradeAsync<T>(rubric: Rubric<T>, output: T): Promise<Grade>;
} {
  const gradeAsync = async <T>(rubric: Rubric<T>, output: T): Promise<Grade> => {
    const { output: verdict } = await runAgent({
      agent: judgeAgent,
      workspaceId,
      sessionKey: `eval-judge:${Date.now()}:${Math.random()}`,
      input: JSON.stringify({
        rubric: rubric.map((c) => ({ id: c.id, criterion: c.description })),
        output,
      }),
    });
    const passed = verdict.criteria.filter((c) => c.pass).map((c) => c.id);
    const failed = verdict.criteria.filter((c) => !c.pass).map((c) => c.id);
    return { score: passed.length / Math.max(1, rubric.length), passed, failed };
  };
  return {
    // The synchronous `Judge` surface is not supported for the LLM judge; use `gradeAsync`.
    grade() {
      throw new Error('llmJudge is async: call gradeAsync()');
    },
    gradeAsync,
  };
}
