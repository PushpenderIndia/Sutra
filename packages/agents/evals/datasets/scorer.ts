import type { EmailConfidence, Fit, Icp, LlmProspectScore } from '@sutra/domain';
import { blendScore, fitForScore, preFilter, rulesScore } from '../../src/enricher/scoring.ts';
import { type EvalReport, metric, ratio } from '../framework.ts';

/**
 * Scorer golden set (PR 09 deferred its "20 fixture companies with expected `fit`" here). Each case
 * is a fully specified prospect — the firmographic pre-filter inputs, the deterministic rules inputs
 * and the scorer LLM's assessment — with the `fit` band a human expects. The eval runs the real
 * scoring pipeline (`preFilter` → `rulesScore` → `blendScore`) and measures fit accuracy, so a change
 * that silently shifts the bands is caught. No LLM call: the LLM's contribution is a fixed `llmScore`.
 */

/** A shared, realistic ICP: SEA F&B operators. Country/disqualifier rules drive the pre-filter. */
const ICP: Icp = {
  firmographics: {
    industries: ['Food & Beverage', 'Hospitality', 'Retail'],
    sizes: ['11-50', '51-200', '201-1000'],
    countries: ['SG', 'ID', 'VN', 'MY'],
    keywords: ['outlets', 'franchise', 'delivery'],
    technologies: ['POS'],
  },
  personas: [
    {
      title: 'Head of Operations',
      altTitles: ['Ops Lead'],
      seniority: 'director',
      pains: ['reorder lead times'],
      goals: ['open outlets faster'],
      objections: ['switching cost'],
    },
  ],
  // Four signals, so matched/total lands on clean quarters.
  buyingSignals: ['opened a new outlet', 'hiring staff', 'launched delivery', 'raised funding'],
  disqualifiers: ['enterprise', 'government'],
  rationale: 'Mid-market F&B operators across SEA expanding their outlet network.',
};

interface ScorerCase {
  name: string;
  country: string;
  industry: string;
  domain: string;
  /** Best contact email confidence, or `none` when no contact was found. */
  email?: EmailConfidence;
  /** A contact matched an ICP persona. */
  personaMatch?: boolean;
  /** How many independent sources found the company (0..3+). */
  sources: number;
  /** How many of the four ICP buying signals the research observed. */
  matched: number;
  /** The scorer LLM's own 0–100 assessment (blended 0.6 with the rules score). */
  llmScore: number;
  /** Domain is suppressed (opt-out, bounce, manual block). */
  suppressed?: boolean;
  expected: Fit;
}

/** Runs the full scoring pipeline for one case exactly as the enricher does. */
function scoreCase(c: ScorerCase): { fit: Fit; score: number } {
  const company = { name: c.name, country: c.country, industry: c.industry, domain: c.domain };
  const suppressedDomains = new Set(c.suppressed ? [c.domain.toLowerCase()] : []);
  const dq = preFilter({ company, icp: ICP, suppressedDomains });
  if (dq) return { fit: dq.fit, score: dq.score };

  const contacts = c.email
    ? [
        {
          emailConfidence: c.email,
          personaMatch: c.personaMatch ? 'Head of Operations' : undefined,
        },
      ]
    : [];
  const rules = rulesScore({
    sources: Array.from({ length: c.sources }, (_, i) => ({ source: `src${i}` })),
    contacts,
    icp: ICP,
    research: { matchedIcpSignals: ICP.buyingSignals.slice(0, c.matched) },
  });
  const llm: LlmProspectScore = { score: c.llmScore, reasons: [] };
  const blended = blendScore(llm, rules);
  return { fit: blended.fit, score: blended.score };
}

export const scorerCases: ScorerCase[] = [
  // Strong: decision-maker, verified email, many sources, strong signals, high LLM score.
  {
    name: 'Kopi Nusantara',
    country: 'ID',
    industry: 'Food & Beverage',
    domain: 'kopinusantara.example',
    email: 'verified',
    personaMatch: true,
    sources: 3,
    matched: 4,
    llmScore: 92,
    expected: 'strong',
  },
  {
    name: 'Kaya Toast Club',
    country: 'SG',
    industry: 'Food & Beverage',
    domain: 'kayatoastclub.example',
    email: 'verified',
    personaMatch: true,
    sources: 3,
    matched: 3,
    llmScore: 88,
    expected: 'strong',
  },
  {
    name: 'Pho Saigon House',
    country: 'VN',
    industry: 'Hospitality',
    domain: 'phosaigonhouse.example',
    email: 'verified',
    personaMatch: true,
    sources: 2,
    matched: 4,
    llmScore: 90,
    expected: 'strong',
  },
  {
    name: 'Nasi Padang Express',
    country: 'ID',
    industry: 'Food & Beverage',
    domain: 'nasipadang.example',
    email: 'pattern',
    personaMatch: true,
    sources: 3,
    matched: 4,
    llmScore: 95,
    expected: 'strong',
  },
  {
    name: 'Lion City Bakes',
    country: 'SG',
    industry: 'Retail',
    domain: 'lioncitybakes.example',
    email: 'verified',
    personaMatch: true,
    sources: 3,
    matched: 3,
    llmScore: 85,
    expected: 'strong',
  },

  // Medium: partial persona or email, moderate sources/signals, middling LLM score.
  {
    name: 'Teh Tarik Corner',
    country: 'MY',
    industry: 'Food & Beverage',
    domain: 'tehtarik.example',
    email: 'pattern',
    personaMatch: true,
    sources: 2,
    matched: 2,
    llmScore: 45,
    expected: 'medium',
  },
  {
    name: 'Bakmi Jakarta',
    country: 'ID',
    industry: 'Food & Beverage',
    domain: 'bakmijakarta.example',
    email: 'verified',
    personaMatch: false,
    sources: 2,
    matched: 2,
    llmScore: 55,
    expected: 'medium',
  },
  {
    name: 'Hawker Heroes',
    country: 'SG',
    industry: 'Hospitality',
    domain: 'hawkerheroes.example',
    email: 'pattern',
    personaMatch: true,
    sources: 1,
    matched: 3,
    llmScore: 50,
    expected: 'medium',
  },
  {
    name: 'Banh Mi Brothers',
    country: 'VN',
    industry: 'Food & Beverage',
    domain: 'banhmibros.example',
    email: 'role',
    personaMatch: true,
    sources: 2,
    matched: 3,
    llmScore: 55,
    expected: 'medium',
  },
  {
    name: 'Roti Prata Place',
    country: 'SG',
    industry: 'Retail',
    domain: 'rotiprata.example',
    email: 'verified',
    personaMatch: true,
    sources: 1,
    matched: 1,
    llmScore: 48,
    expected: 'medium',
  },

  // Weak: thin contact data, few sources, no signals, low LLM score.
  {
    name: 'Warung Kecil',
    country: 'ID',
    industry: 'Food & Beverage',
    domain: 'warungkecil.example',
    email: 'role',
    personaMatch: false,
    sources: 1,
    matched: 0,
    llmScore: 20,
    expected: 'weak',
  },
  {
    name: 'Corner Cafe',
    country: 'MY',
    industry: 'Food & Beverage',
    domain: 'cornercafe.example',
    email: 'role',
    sources: 1,
    matched: 0,
    llmScore: 25,
    expected: 'weak',
  },
  {
    name: 'Snack Shack',
    country: 'SG',
    industry: 'Retail',
    domain: 'snackshack.example',
    email: 'pattern',
    sources: 1,
    matched: 1,
    llmScore: 18,
    expected: 'weak',
  },
  {
    name: 'Quick Bites',
    country: 'VN',
    industry: 'Hospitality',
    domain: 'quickbites.example',
    sources: 1,
    matched: 0,
    llmScore: 30,
    expected: 'weak',
  },
  {
    name: 'Street Eats',
    country: 'ID',
    industry: 'Food & Beverage',
    domain: 'streeteats.example',
    email: 'role',
    personaMatch: false,
    sources: 2,
    matched: 1,
    llmScore: 22,
    expected: 'weak',
  },

  // Disqualified: outside ICP country, a disqualifier keyword, or a suppressed domain.
  {
    name: 'Tokyo Ramen Co',
    country: 'JP',
    industry: 'Food & Beverage',
    domain: 'tokyoramen.example',
    email: 'verified',
    personaMatch: true,
    sources: 3,
    matched: 4,
    llmScore: 95,
    expected: 'disqualified',
  },
  {
    name: 'Sydney Eats',
    country: 'AU',
    industry: 'Food & Beverage',
    domain: 'sydneyeats.example',
    email: 'verified',
    personaMatch: true,
    sources: 3,
    matched: 4,
    llmScore: 90,
    expected: 'disqualified',
  },
  {
    name: 'Government Canteen Services',
    country: 'SG',
    industry: 'Food & Beverage',
    domain: 'govcanteen.example',
    email: 'verified',
    personaMatch: true,
    sources: 3,
    matched: 4,
    llmScore: 88,
    expected: 'disqualified',
  },
  {
    name: 'Enterprise Catering Group',
    country: 'ID',
    industry: 'Food & Beverage',
    domain: 'enterprisecatering.example',
    email: 'verified',
    personaMatch: true,
    sources: 3,
    matched: 3,
    llmScore: 85,
    expected: 'disqualified',
  },
  {
    name: 'Opted Out Bistro',
    country: 'SG',
    industry: 'Food & Beverage',
    domain: 'optedout.example',
    email: 'verified',
    personaMatch: true,
    sources: 3,
    matched: 4,
    llmScore: 92,
    suppressed: true,
    expected: 'disqualified',
  },
];

/** Measures fit accuracy of the scoring pipeline against the golden labels. Target ≥ 90%. */
export function evaluateScorer(): EvalReport {
  const correct = scorerCases.filter((c) => scoreCase(c).fit === c.expected);
  const accuracy = ratio(correct.length, scorerCases.length);
  return {
    agent: 'scorer',
    description: '20 companies, expected fit band through preFilter → rulesScore → blendScore',
    cases: scorerCases.length,
    metrics: [
      metric('fit accuracy', accuracy, 0.9, {
        note: `${correct.length}/${scorerCases.length} correct`,
      }),
    ],
  };
}

/** Exposed for tests: fit-band thresholds the golden set is calibrated against. */
export const scorerFit = fitForScore;
