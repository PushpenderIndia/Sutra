/**
 * The eval framework (PR 18). Every agent set is scored offline with the same two tools:
 *
 *  - **exact checks** — deterministic assertions (fit band, reply intent, schema validity,
 *    grounding of a cited URL, a bandit's traffic share), run with no model at all; and
 *  - a **rubric judge** — a set of named pass/fail criteria. In CI the criteria are deterministic
 *    functions (fully offline). In production `pnpm eval` can swap in an LLM judge (`sutra-smart`,
 *    {@link LlmJudge}) that grades the softer criteria ("sensible ICP", "correct register").
 *
 * Each set returns an {@link EvalReport} of {@link Metric}s with their targets; `evals.test.ts`
 * fails the build if any metric is below target, and `pnpm eval` writes them to `evals/report.md`.
 */

/** A small tolerance so a target of 0.9 is not failed by floating-point noise. */
const EPS = 1e-9;

export interface Metric {
  name: string;
  /** The measured value (a rate in 0..1 for accuracy/pass-rate metrics, else a raw number). */
  value: number;
  /** The minimum acceptable value; `value >= target` passes. */
  target: number;
  /** `%` renders value/target as percentages in the report. */
  unit?: '%' | '';
  pass: boolean;
  /** Short human note (e.g. "18/20 correct"). */
  note?: string;
}

export interface EvalReport {
  agent: string;
  /** One-line description of what the set measures. */
  description: string;
  cases: number;
  metrics: Metric[];
}

export const ratio = (n: number, total: number): number => (total ? n / total : 0);

/** Builds a metric, computing `pass` from the value and target. */
export function metric(
  name: string,
  value: number,
  target: number,
  opts: { unit?: '%' | ''; note?: string } = {},
): Metric {
  return {
    name,
    value,
    target,
    unit: opts.unit ?? '%',
    note: opts.note,
    pass: value + EPS >= target,
  };
}

/** Whether every metric in a report meets its target. */
export const reportPassed = (report: EvalReport): boolean => report.metrics.every((m) => m.pass);

// ── Rubric judge ────────────────────────────────────────────────────────────

export interface Criterion<T> {
  id: string;
  description: string;
  /** Deterministic, offline check. The LLM judge replaces this with a graded call in production. */
  check: (output: T) => boolean;
}

export type Rubric<T> = readonly Criterion<T>[];

export interface Grade {
  /** Fraction of criteria that passed, 0..1. */
  score: number;
  passed: string[];
  failed: string[];
}

export interface Judge {
  grade<T>(rubric: Rubric<T>, output: T): Grade;
}

/** The deterministic rubric judge used in CI: the score is the fraction of criteria that pass. */
export const rubricJudge: Judge = {
  grade(rubric, output) {
    const passed: string[] = [];
    const failed: string[] = [];
    for (const c of rubric) (c.check(output) ? passed : failed).push(c.id);
    return { score: ratio(passed.length, rubric.length), passed, failed };
  },
};

/**
 * Grades a set of outputs against a rubric and reports the mean rubric score and the fraction of
 * outputs that pass every criterion. The caller turns these into {@link Metric}s with their targets.
 */
export function gradeSet<T>(
  rubric: Rubric<T>,
  outputs: readonly T[],
  judge: Judge = rubricJudge,
): { grades: Grade[]; fullPass: number; meanScore: number } {
  const grades = outputs.map((o) => judge.grade(rubric, o));
  const fullPass = ratio(grades.filter((g) => g.score >= 1 - EPS).length, grades.length);
  const meanScore = ratio(
    grades.reduce((s, g) => s + g.score, 0),
    grades.length,
  );
  return { grades, fullPass, meanScore };
}
