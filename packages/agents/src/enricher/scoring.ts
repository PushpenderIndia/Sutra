import type {
  Company,
  CompanyResearch,
  Contact,
  EmailConfidence,
  Fit,
  Icp,
  LlmProspectScore,
  ProspectScore,
  ScoreReason,
} from '@sutra/domain';

/**
 * Scoring weights (README principle 4: config is data). `blend` mixes the LLM score with the
 * deterministic rules score (`final = blend.llm * llm + blend.rules * rules`); `rules` weighs the
 * deterministic factors; `fit` sets the thresholds on the final blended score.
 */
export interface ScoreWeights {
  blend: { llm: number; rules: number };
  rules: { persona: number; email: number; sources: number; signals: number };
  fit: { strong: number; medium: number };
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  blend: { llm: 0.6, rules: 0.4 },
  rules: { persona: 0.3, email: 0.2, sources: 0.2, signals: 0.3 },
  fit: { strong: 75, medium: 50 },
};

const EMAIL_WEIGHT: Record<EmailConfidence, number> = { verified: 1, pattern: 0.6, role: 0.3 };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Fit band for a final blended score. Disqualification is decided separately, in {@link preFilter}. */
export const fitForScore = (score: number, w: ScoreWeights = DEFAULT_SCORE_WEIGHTS): Fit =>
  score >= w.fit.strong ? 'strong' : score >= w.fit.medium ? 'medium' : 'weak';

export interface PreFilterInput {
  company: Pick<Company, 'name' | 'country' | 'industry' | 'domain'>;
  icp: Icp;
  /** Lower-cased suppressed domains (opt-outs, bounces, manual blocks). */
  suppressedDomains: ReadonlySet<string>;
}

export interface Disqualification {
  fit: 'disqualified';
  score: 0;
  reasons: ScoreReason[];
}

/**
 * The deterministic pre-filter. A prospect in a country outside the ICP, matching a disqualifier
 * keyword, or on a suppressed domain is `disqualified` here — with **no LLM call**. Returns
 * `undefined` when the prospect passes and should be researched and scored.
 */
export function preFilter({
  company,
  icp,
  suppressedDomains,
}: PreFilterInput): Disqualification | undefined {
  const disqualified = (text: string, evidence: string): Disqualification => ({
    fit: 'disqualified',
    score: 0,
    reasons: [{ text, weight: 1, evidence }],
  });

  const domain = company.domain?.toLowerCase();
  if (domain && suppressedDomains.has(domain)) return disqualified('Domain is suppressed', domain);

  if (company.country && !icp.firmographics.countries.includes(company.country))
    return disqualified('Country is outside the ICP', company.country);

  const haystack = [company.name, company.industry].filter(Boolean).join(' ').toLowerCase();
  for (const term of icp.disqualifiers) {
    const needle = term.trim().toLowerCase();
    if (needle && haystack.includes(needle))
      return disqualified('Matches an ICP disqualifier', term);
  }
  return undefined;
}

export interface RulesInput {
  /** Every source that found the company (de-duped inside). */
  sources: readonly { source: string }[];
  contacts: readonly Pick<Contact, 'emailConfidence' | 'personaMatch'>[];
  icp: Icp;
  research?: Pick<CompanyResearch, 'matchedIcpSignals'>;
}

/**
 * The deterministic rules score (0–100): persona match quality, best email confidence, how many
 * sources found the company, and how many ICP buying signals were observed. Pure TypeScript, so it
 * is fully testable and never varies between runs.
 */
export function rulesScore(
  input: RulesInput,
  w: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): { score: number; reasons: ScoreReason[] } {
  const matched = input.research?.matchedIcpSignals ?? [];
  const totalSignals = input.icp.buyingSignals.length;
  const sourceCount = new Set(input.sources.map((s) => s.source)).size;

  const persona = input.contacts.some((c) => c.personaMatch) ? 1 : input.contacts.length ? 0.3 : 0;
  const email = input.contacts.reduce(
    (best, c) => Math.max(best, EMAIL_WEIGHT[c.emailConfidence]),
    0,
  );
  const sources = clamp01(sourceCount / 3);
  const signals = totalSignals ? clamp01(matched.length / totalSignals) : input.research ? 0.5 : 0;

  const score = Math.round(
    100 *
      (w.rules.persona * persona +
        w.rules.email * email +
        w.rules.sources * sources +
        w.rules.signals * signals),
  );

  const reasons: ScoreReason[] = [];
  if (persona >= 1)
    reasons.push({
      text: 'A decision-maker matches an ICP persona',
      weight: w.rules.persona,
      evidence: input.contacts.find((c) => c.personaMatch)?.personaMatch ?? 'persona match',
    });
  if (matched.length)
    reasons.push({
      text: `${matched.length} ICP buying signal${matched.length > 1 ? 's' : ''} observed`,
      weight: w.rules.signals,
      evidence: matched.join(', '),
    });
  if (sourceCount >= 2)
    reasons.push({
      text: `Found by ${sourceCount} independent sources`,
      weight: w.rules.sources,
      evidence: [...new Set(input.sources.map((s) => s.source))].join(', '),
    });

  return { score, reasons };
}

/**
 * Blends the scorer LLM's assessment with the deterministic rules score into the final
 * {@link ProspectScore}. Reasons from both sides are merged (LLM first) and capped at six.
 */
export function blendScore(
  llm: LlmProspectScore,
  rules: { score: number; reasons: ScoreReason[] },
  w: ScoreWeights = DEFAULT_SCORE_WEIGHTS,
): ProspectScore {
  const score = Math.max(
    0,
    Math.min(100, Math.round(w.blend.llm * llm.score + w.blend.rules * rules.score)),
  );
  const reasons = [...llm.reasons, ...rules.reasons].slice(0, 6);
  return { score, fit: fitForScore(score, w), reasons };
}
