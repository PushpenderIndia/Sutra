import { z } from 'zod';
import { country, source } from './common.ts';
import { companySize } from './profile.ts';
import { emailConfidence } from './prospects.ts';

/** How expensive a {@link LeadSource} is to call, shown as a chip and used to order the fan-out. */
export const sourceCost = z.enum(['free', 'quota', 'paid']);
export type SourceCost = z.infer<typeof sourceCost>;

/**
 * A concrete query a source's planner turns the ICP into. `resembles` names the customer a
 * lookalike query was derived from, so a found company can record which customer it looks like.
 */
export const sourceQuery = z.object({
  source,
  text: z.string().min(1),
  resembles: z.string().optional(),
  country: country.optional(),
  city: z.string().optional(),
  /** Max results this one query should contribute (defaults to the per-run budget). */
  limit: z.int().min(1).optional(),
});
export type SourceQuery = z.infer<typeof sourceQuery>;

/**
 * A company exactly as a source found it, before normalise → dedupe → upsert. `ref` records what
 * the source matched on (the query text, a place id, a registry id…) so the match is auditable.
 */
export const companyDraft = z.object({
  kind: z.literal('company'),
  name: z.string().min(1),
  website: z.string().optional(),
  domain: z.string().optional(),
  country: country.optional(),
  city: z.string().optional(),
  industry: z.string().optional(),
  size: companySize.optional(),
  description: z.string().optional(),
  source,
  ref: z.string(),
  resembles: z.string().optional(),
  sourceUrl: z.url().optional(),
});
export type CompanyDraft = z.infer<typeof companyDraft>;

/** A contact as a source found it. It links to its company by domain (preferred) or name. */
export const contactDraft = z.object({
  kind: z.literal('contact'),
  companyDomain: z.string().optional(),
  companyName: z.string().optional(),
  name: z.string().optional(),
  firstName: z.string().optional(),
  title: z.string().optional(),
  email: z.string(),
  emailConfidence,
  source,
  personaMatch: z.string().optional(),
});
export type ContactDraft = z.infer<typeof contactDraft>;

/** What a source's `fetch` streams: either a company or a contact. */
export const leadDraft = z.discriminatedUnion('kind', [companyDraft, contactDraft]);
export type LeadDraft = z.infer<typeof leadDraft>;
