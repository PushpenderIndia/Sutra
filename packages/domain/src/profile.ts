import { z } from 'zod';
import { count, country, doc } from './common.ts';
import { profileStatus } from './status.ts';

/** The user's own company, as written by the profiler (PR 07). */
export const businessProfile = z.object({
  name: z.string().min(1),
  website: z.url(),
  oneLiner: z.string().max(160),
  offerings: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        pricingHint: z.string().optional(),
      }),
    )
    .max(8),
  proofPoints: z.array(z.object({ text: z.string(), sourceUrl: z.url() })).max(8),
  customers: z
    .array(z.object({ name: z.string(), domain: z.string().optional(), sourceUrl: z.url() }))
    .max(30),
  geographies: z.array(country),
  differentiators: z.array(z.string()).max(6),
  competitors: z.array(z.object({ name: z.string(), domain: z.string().optional() })).max(8),
  toneOfVoice: z.string().max(200),
  sources: z.array(z.url()).min(1),
});
export type BusinessProfile = z.infer<typeof businessProfile>;

export const companySize = z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']);
export const seniority = z.enum(['owner', 'c_level', 'vp', 'director', 'manager', 'ic']);

export const persona = z.object({
  title: z.string(),
  altTitles: z.array(z.string()).max(6),
  seniority,
  pains: z.array(z.string()).max(5),
  goals: z.array(z.string()).max(5),
  objections: z.array(z.string()).max(5),
});
export type Persona = z.infer<typeof persona>;

/** Ideal customer profile and buyer personas (PR 07). */
export const icp = z.object({
  firmographics: z.object({
    industries: z.array(z.string()).min(1).max(8),
    sizes: z.array(companySize),
    countries: z.array(country).min(1),
    keywords: z.array(z.string()).max(15),
    technologies: z.array(z.string()).max(10),
  }),
  personas: z.array(persona).min(1).max(4),
  buyingSignals: z.array(z.string()).max(8),
  disqualifiers: z.array(z.string()).max(8),
  rationale: z.string().max(600),
});
export type Icp = z.infer<typeof icp>;

/** One crawled page, cleaned to readable text (PR 07 `crawler`). */
export const crawlPage = z.object({
  url: z.url(),
  title: z.string(),
  description: z.string().optional(),
  headings: z.array(z.string()),
  text: z.string(),
});
export type CrawlPage = z.infer<typeof crawlPage>;

/** The crawler's output for one domain; cached for 7 days. */
export const crawlResult = z.object({
  website: z.url(),
  domain: z.string(),
  pages: z.array(crawlPage),
  /** `alt` text of customer-logo images (seeds for lookalikes). */
  logos: z.array(z.string()),
  fetchedAt: z.date(),
  /** True when the Gemini `url_context` fallback was used for a JS-only site. */
  usedFallback: z.boolean(),
});
export type CrawlResult = z.infer<typeof crawlResult>;

/** A fact the web researcher found, always with the page it came from. */
export const researchFinding = z.object({ text: z.string(), sourceUrl: z.url() });
export type ResearchFinding = z.infer<typeof researchFinding>;

/** `webResearch` output: grounded findings plus the queries that produced them. */
export const webResearchResult = z.object({
  findings: z.array(researchFinding),
  queries: z.array(z.string()),
});
export type WebResearchResult = z.infer<typeof webResearchResult>;

/** Each edit is saved as a new `version`; the latest confirmed one drives the pipeline. */
const versioned = { status: profileStatus, version: count.min(1) };

export const businessProfileDoc = doc({ ...businessProfile.shape, ...versioned });
export const icpDoc = doc({ ...icp.shape, ...versioned });
export type BusinessProfileDoc = z.infer<typeof businessProfileDoc>;
export type IcpDoc = z.infer<typeof icpDoc>;
