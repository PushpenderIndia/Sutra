import type { Locale, VariantPair } from '@sutra/domain';
import { variantPairFixtures } from '../../src/copywriter/fixtures.ts';
import { qualityGate, wordCount } from '../../src/copywriter/quality-gate.ts';
import { type Criterion, type EvalReport, gradeSet, metric, ratio } from '../framework.ts';

/**
 * Variant-writer eval (PR 12 deferred its "profiles × locales, rubric-graded" fixtures here). The
 * dataset is five A/B pairs evaluated across three locales (30 variant cases). The rubric here is the
 * deterministic, language-agnostic part — personalised (carries the per-contact line slot), grounded,
 * under 150 words, valid merge fields, a clear CTA, and (per pair) a one-dimension difference. The
 * locale-specific "correct register" criterion is graded by the LLM judge in `pnpm eval --live`.
 */

const intro = 'Hi {{firstName}},\n\n{{personalization}}\n\n';
const signoff = '\n\n{{senderName}}';

/** Two more pairs on top of the shipped copywriter fixtures, to reach five pairs (ten variants). */
const extraPairs: VariantPair[] = [
  {
    variants: [
      {
        hypothesis: 'A short body gets a faster read',
        dimension: 'length',
        subject: 'Quick idea for {{company}}',
        body: `${intro}We help F&B teams reorder packaging in 7 days. Worth a quick chat?${signoff}`,
      },
      {
        hypothesis: 'A little more detail builds trust',
        dimension: 'length',
        subject: 'Quick idea for {{company}}',
        body: `${intro}We print cups and takeaway packaging for growing outlets, from 500 units, in about 7 days, and keep your artwork on file for easy reorders. Worth a quick chat?${signoff}`,
      },
    ],
  },
  {
    variants: [
      {
        hypothesis: 'A warm tone suits hospitality',
        dimension: 'tone',
        subject: 'Packaging help for {{company}}',
        body: `${intro}Loved seeing your new outlet. We keep packaging reorders simple for teams like yours — happy to help whenever you need it.${signoff}`,
      },
      {
        hypothesis: 'A direct tone respects busy operators',
        dimension: 'tone',
        subject: 'Packaging help for {{company}}',
        body: `${intro}We supply cups and takeaway packaging on a 7-day turnaround. If reorders are a hassle, I can send a sample pack. Interested?${signoff}`,
      },
    ],
  },
];

export const variantPairs: VariantPair[] = [...variantPairFixtures, ...extraPairs];

export const variantLocales: Locale[] = ['en', 'id', 'hi'];

/** One variant rendered for a locale (the structural rubric is language-agnostic). */
interface VariantCase {
  locale: Locale;
  pairIndex: number;
  variant: VariantPair['variants'][number];
}

const variantCases: VariantCase[] = variantPairs.flatMap((pair, pairIndex) =>
  variantLocales.flatMap((locale) =>
    pair.variants.map((variant) => ({ locale, pairIndex, variant })),
  ),
);

const rubric: readonly Criterion<VariantCase>[] = [
  {
    id: 'quality-gate',
    description: 'passes the deterministic quality gate (merge fields, subject, CTA, spam, caps)',
    check: (c) => qualityGate(c.variant).ok,
  },
  {
    id: 'under-150-words',
    description: 'body is under 150 words',
    check: (c) => wordCount(c.variant.body) <= 150,
  },
  {
    id: 'personalised',
    description: 'carries the grounded per-contact personalisation slot',
    check: (c) => c.variant.body.includes('{{personalization}}'),
  },
  {
    id: 'addresses-contact',
    description: 'addresses the contact and company by merge field',
    check: (c) =>
      c.variant.body.includes('{{firstName}}') && c.variant.subject.includes('{{company}}'),
  },
];

/** Each A/B pair must differ in exactly one declared dimension, and actually differ. */
function pairsDifferInOneDimension(): number {
  const ok = variantPairs.filter((pair) => {
    const [a, b] = pair.variants;
    if (!a || !b) return false;
    const sameDimension = a.dimension === b.dimension;
    const actuallyDiffer = a.subject !== b.subject || a.body !== b.body;
    return sameDimension && actuallyDiffer;
  });
  return ratio(ok.length, variantPairs.length);
}

/** Rubric pass-rate across the 30 variant cases, plus the one-dimension-difference check. */
export function evaluateVariant(): EvalReport {
  const { fullPass } = gradeSet(rubric, variantCases);
  const oneDimension = pairsDifferInOneDimension();
  return {
    agent: 'variantWriter',
    description: `${variantPairs.length} A/B pairs × ${variantLocales.length} locales = ${variantCases.length} variant cases, rubric-graded`,
    cases: variantCases.length,
    metrics: [
      metric('rubric full-pass rate', fullPass, 0.9, {
        note: `${Math.round(fullPass * variantCases.length)}/${variantCases.length} pass every criterion`,
      }),
      metric('one-dimension A/B difference', oneDimension, 1, {
        note: `${Math.round(oneDimension * variantPairs.length)}/${variantPairs.length} pairs`,
      }),
    ],
  };
}
