import type { Icp } from '@sutra/domain';
import { describe, expect, it } from 'vitest';
import { buildResearch } from './researcher.ts';
import {
  blendScore,
  DEFAULT_SCORE_WEIGHTS,
  fitForScore,
  preFilter,
  rulesScore,
} from './scoring.ts';

const ICP: Icp = {
  firmographics: {
    industries: ['Coffee chain'],
    sizes: ['11-50'],
    countries: ['SG', 'ID'],
    keywords: [],
    technologies: [],
  },
  personas: [
    {
      title: 'Head of Operations',
      altTitles: [],
      seniority: 'director',
      pains: [],
      goals: [],
      objections: [],
    },
  ],
  buyingSignals: ['opened a new outlet', 'launched a delivery menu'],
  disqualifiers: ['franchise only'],
  rationale: 'F&B chains in SEA.',
};

const company = (over: Partial<Parameters<typeof preFilter>[0]['company']> = {}) => ({
  name: 'Kopi Nusantara',
  country: 'ID' as const,
  industry: 'Coffee chain',
  domain: 'kopinusantara.example',
  ...over,
});

describe('pre-filter (deterministic, no LLM)', () => {
  const none = new Set<string>();

  it('passes a prospect inside the ICP', () => {
    expect(preFilter({ company: company(), icp: ICP, suppressedDomains: none })).toBeUndefined();
  });

  it('disqualifies a country outside the ICP', () => {
    const dq = preFilter({
      company: company({ country: 'US' }),
      icp: ICP,
      suppressedDomains: none,
    });
    expect(dq?.fit).toBe('disqualified');
    expect(dq?.score).toBe(0);
    expect(dq?.reasons[0]?.evidence).toBe('US');
  });

  it('disqualifies on a disqualifier keyword', () => {
    const dq = preFilter({
      company: company({ industry: 'Coffee franchise only' }),
      icp: ICP,
      suppressedDomains: none,
    });
    expect(dq?.fit).toBe('disqualified');
    expect(dq?.reasons[0]?.evidence).toBe('franchise only');
  });

  it('disqualifies a suppressed domain', () => {
    const dq = preFilter({
      company: company(),
      icp: ICP,
      suppressedDomains: new Set(['kopinusantara.example']),
    });
    expect(dq?.fit).toBe('disqualified');
  });

  it('does not disqualify when the country is unknown', () => {
    expect(
      preFilter({ company: company({ country: undefined }), icp: ICP, suppressedDomains: none }),
    ).toBeUndefined();
  });
});

describe('rules score (deterministic)', () => {
  it('rewards persona match, confidence, sources and matched signals', () => {
    const strong = rulesScore({
      sources: [{ source: 'search' }, { source: 'places' }, { source: 'registry' }],
      contacts: [{ emailConfidence: 'verified', personaMatch: 'Head of Operations' }],
      icp: ICP,
      research: { matchedIcpSignals: ['opened a new outlet', 'launched a delivery menu'] },
    });
    expect(strong.score).toBe(100);
    expect(strong.reasons.length).toBeGreaterThan(0);
  });

  it('scores a thin prospect low', () => {
    const weak = rulesScore({
      sources: [{ source: 'search' }],
      contacts: [{ emailConfidence: 'role' }],
      icp: ICP,
      research: undefined,
    });
    expect(weak.score).toBeLessThan(40);
  });

  it('is pure: same input, same score', () => {
    const input = {
      sources: [{ source: 'search' }],
      contacts: [{ emailConfidence: 'pattern' as const, personaMatch: 'Head of Operations' }],
      icp: ICP,
      research: { matchedIcpSignals: ['opened a new outlet'] },
    };
    expect(rulesScore(input).score).toBe(rulesScore(input).score);
  });
});

describe('blend and fit bands', () => {
  it('blends 0.6 LLM + 0.4 rules', () => {
    const score = blendScore({ score: 90, reasons: [] }, { score: 40, reasons: [] });
    expect(score.score).toBe(Math.round(0.6 * 90 + 0.4 * 40)); // 70
    expect(score.fit).toBe('medium');
  });

  it('merges reasons, LLM first, capped at six', () => {
    const llm = Array.from({ length: 5 }, (_, i) => ({
      text: `l${i}`,
      weight: 0.1,
      evidence: 'e',
    }));
    const rules = Array.from({ length: 4 }, (_, i) => ({
      text: `r${i}`,
      weight: 0.1,
      evidence: 'e',
    }));
    const score = blendScore({ score: 80, reasons: llm }, { score: 80, reasons: rules });
    expect(score.reasons).toHaveLength(6);
    expect(score.reasons[0]?.text).toBe('l0');
  });

  it('maps scores to fit bands', () => {
    expect(fitForScore(DEFAULT_SCORE_WEIGHTS.fit.strong)).toBe('strong');
    expect(fitForScore(DEFAULT_SCORE_WEIGHTS.fit.medium)).toBe('medium');
    expect(fitForScore(DEFAULT_SCORE_WEIGHTS.fit.medium - 1)).toBe('weak');
  });
});

describe('research builder', () => {
  it('drops signals without a source URL and collects sources', () => {
    const research = buildResearch(
      {
        summary: 'Growing coffee chain',
        signals: [
          {
            kind: 'expansion',
            text: 'Opened an outlet',
            sourceUrl: 'https://kopinusantara.example/news',
          },
          { kind: 'hiring', text: 'Hiring baristas' }, // no sourceUrl → dropped
          { kind: 'news', text: 'Bad url', sourceUrl: 'not-a-url' }, // invalid → dropped
        ],
        matchedIcpSignals: ['opened a new outlet'],
        websiteLanguage: 'id',
      },
      ['https://directory.example/kopi'],
    );
    expect(research?.signals).toHaveLength(1);
    expect(research?.signals.every((s) => s.sourceUrl.startsWith('http'))).toBe(true);
    expect(research?.sources).toContain('https://directory.example/kopi');
    expect(research?.sources).toContain('https://kopinusantara.example/news');
    expect(research?.websiteLanguage).toBe('id');
  });

  it('is undefined when there are no sources at all', () => {
    expect(buildResearch({ summary: 'x', signals: [] }, [])).toBeUndefined();
  });

  it('coerces an unknown signal kind to "other"', () => {
    const research = buildResearch(
      { signals: [{ kind: 'weird', text: 'fact', sourceUrl: 'https://a.example' }] },
      [],
    );
    expect(research?.signals[0]?.kind).toBe('other');
  });
});
