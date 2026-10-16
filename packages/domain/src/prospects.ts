import { z } from 'zod';
import { country, doc, id, locale, source, timezone } from './common.ts';
import { companySize } from './profile.ts';
import { companyStatus, contactStatus } from './status.ts';

/** Researcher output per company (PR 09). Every signal cites a source. */
export const companyResearch = z.object({
  summary: z.string().max(600),
  signals: z
    .array(
      z.object({
        kind: z.enum([
          'hiring',
          'funding',
          'expansion',
          'launch',
          'pain_point',
          'tech_stack',
          'news',
          'other',
        ]),
        text: z.string(),
        sourceUrl: z.url(),
        date: z.string().optional(),
      }),
    )
    .max(10),
  matchedIcpSignals: z.array(z.string()),
  websiteLanguage: locale.optional(),
  sources: z.array(z.url()).min(1),
});
export type CompanyResearch = z.infer<typeof companyResearch>;

export const fit = z.enum(['strong', 'medium', 'weak', 'disqualified']);
export const scoreReason = z.object({ text: z.string(), weight: z.number(), evidence: z.string() });

/** Scorer output (PR 09). */
export const prospectScore = z.object({
  score: z.int().min(0).max(100),
  fit,
  reasons: z.array(scoreReason).max(6),
});
export type ProspectScore = z.infer<typeof prospectScore>;

/** Where a company was found. `resembles` names the customer a lookalike was found from. */
export const companySource = z.object({
  source,
  ref: z.string(),
  at: z.date(),
  resembles: z.string().optional(),
});

export const company = doc({
  name: z.string().min(1),
  /** Lower-cased, punctuation-free name; with `country`, the dedupe key when `domain` is unknown. */
  normalizedName: z.string().min(1),
  /** Hostname without `www.`; unique per workspace. */
  domain: z.string().min(3).optional(),
  website: z.url().optional(),
  country,
  city: z.string().optional(),
  timezone: timezone.optional(),
  industry: z.string().optional(),
  size: companySize.optional(),
  sources: z.array(companySource).min(1),
  research: companyResearch.optional(),
  researchedAt: z.date().optional(),
  score: prospectScore.shape.score.optional(),
  fit: fit.optional(),
  scoreReasons: z.array(scoreReason).default([]),
  status: companyStatus.default('new'),
});
export type Company = z.infer<typeof company>;

export const emailConfidence = z.enum(['verified', 'pattern', 'role']);

export const contact = doc({
  companyId: id,
  name: z.string().optional(),
  firstName: z.string().optional(),
  title: z.string().optional(),
  /** Lower-cased; unique per workspace. */
  email: z.email().toLowerCase(),
  emailConfidence,
  source: source.optional(),
  /** Title of the ICP persona this contact matches. */
  personaMatch: z.string().optional(),
  locale,
  timezone,
  status: contactStatus.default('new'),
});
export type Contact = z.infer<typeof contact>;
