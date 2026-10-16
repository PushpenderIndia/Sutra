import { Companies, Contacts } from '@sutra/db';
import type { Company, CompanyDraft, ContactDraft, Country, Id } from '@sutra/domain';
import { contact as contactSchema } from '@sutra/domain';
import {
  countryFromDomain,
  domainFromWebsite,
  localeForCountry,
  normalizeName,
  timezoneForCountry,
  websiteFromDomain,
} from '@sutra/sources';

/** True for a duplicate-key error from a racing insert on the same unique domain. */
const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

export interface UpsertedCompany {
  companyId: Id;
  domain?: string;
  /** False when the draft merged into a company another source had already found. */
  created: boolean;
}

const sourceEntry = (draft: CompanyDraft) => ({
  source: draft.source,
  ref: draft.ref,
  at: new Date(),
  ...(draft.resembles && { resembles: draft.resembles }),
});

const findExisting = (
  workspaceId: Id,
  key: { domain?: string; normalizedName: string; country: Country },
): Promise<Company | null> =>
  key.domain
    ? Companies.findOne(workspaceId, { domain: key.domain })
    : Companies.findOne(workspaceId, { normalizedName: key.normalizedName, country: key.country });

/**
 * Normalises a company draft and upserts it, merging multiple sources onto one company. A company
 * is matched by `domain`, or by `normalizedName + country` when the domain is unknown; its
 * `sources[]` records every source that found it (deduped), which later boosts confidence.
 */
export async function upsertCompanyDraft(
  workspaceId: Id,
  draft: CompanyDraft,
  fallbackCountry: Country,
): Promise<UpsertedCompany> {
  const domain = draft.domain ?? domainFromWebsite(draft.website);
  const normalizedName = normalizeName(draft.name);
  const country = draft.country ?? countryFromDomain(domain, fallbackCountry);
  const website = draft.website ?? (domain ? websiteFromDomain(domain) : undefined);
  const entry = sourceEntry(draft);

  const merge = async (existing: Company): Promise<UpsertedCompany> => {
    const sources = existing.sources.some((s) => s.source === draft.source)
      ? existing.sources
      : [...existing.sources, entry];
    await Companies.update(workspaceId, existing._id, {
      sources,
      website: existing.website ?? website,
      domain: existing.domain ?? domain,
      city: existing.city ?? draft.city,
      industry: existing.industry ?? draft.industry,
      size: existing.size ?? draft.size,
    });
    return { companyId: existing._id, domain: existing.domain ?? domain, created: false };
  };

  const existing = await findExisting(workspaceId, { domain, normalizedName, country });
  if (existing) return merge(existing);

  try {
    const created = await Companies.create(workspaceId, {
      name: draft.name,
      normalizedName,
      domain,
      website,
      country,
      city: draft.city,
      industry: draft.industry,
      size: draft.size,
      sources: [entry],
    });
    return { companyId: created._id, domain, created: true };
  } catch (error) {
    // A racing source inserted the same domain first; merge into it instead.
    if (isDuplicateKey(error) && domain) {
      const racer = await Companies.findOne(workspaceId, { domain });
      if (racer) return merge(racer);
    }
    throw error;
  }
}

/**
 * Links a contact draft to its company (by domain, else name) and creates it if its email is new.
 * Existing contacts are kept untouched, so a re-run never resets a contact's campaign status.
 * Returns true when a new contact was created.
 */
export async function upsertContactDraft(
  workspaceId: Id,
  draft: ContactDraft,
  fallbackCountry: Country,
): Promise<boolean> {
  const email = contactSchema.shape.email.safeParse(draft.email);
  if (!email.success) return false;

  const company = draft.companyDomain
    ? await Companies.findOne(workspaceId, { domain: draft.companyDomain })
    : draft.companyName
      ? await Companies.findOne(workspaceId, { normalizedName: normalizeName(draft.companyName) })
      : null;
  if (!company) return false;

  if (await Contacts.findOne(workspaceId, { email: email.data })) return false;

  const country = company.country ?? fallbackCountry;
  await Contacts.create(workspaceId, {
    companyId: company._id,
    name: draft.name,
    firstName: draft.firstName,
    title: draft.title,
    email: email.data,
    emailConfidence: draft.emailConfidence,
    source: draft.source,
    personaMatch: draft.personaMatch,
    locale: localeForCountry(country),
    timezone: company.timezone ?? timezoneForCountry(country),
  });
  return true;
}
