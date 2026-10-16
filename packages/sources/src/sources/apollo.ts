import type { CompanyDraft, ContactDraft, Icp } from '@sutra/domain';
import { domainFromWebsite } from '../normalize.ts';
import type { LeadSource } from '../types.ts';

/** Apollo people-search filters from the ICP firmographics and persona titles. */
export function apolloFilters(icp: Icp) {
  return {
    industries: icp.firmographics.industries,
    countries: icp.firmographics.countries,
    sizes: icp.firmographics.sizes,
    titles: icp.personas.flatMap((p) => [p.title, ...p.altTitles]),
  };
}

/**
 * `apollo` (optional, paid): people and company search by ICP filters (titles, industries, sizes,
 * countries). Off unless `FEATURE_PAID_SOURCES` is on **and** the workspace added its own key.
 */
export const apolloSource: LeadSource = {
  id: 'apollo',
  label: 'Apollo',
  cost: 'paid',
  enabled: (ctx) =>
    ctx.paidSourcesEnabled && ctx.enabledSources.includes('apollo') && Boolean(ctx.keys.apollo),
  plan: (icp) => [
    { source: 'apollo', text: [...icp.firmographics.industries].join(', ') || 'ICP' },
  ],
  async *fetch(ctx, query) {
    if (!ctx.icp) return;
    const people = await ctx.clients.apollo.search(apolloFilters(ctx.icp), {
      limit: query.limit ?? ctx.budget.maxResults,
    });
    for (const person of people) {
      const hit = person.company;
      const domain = hit.domain ?? domainFromWebsite(hit.website);
      const company: CompanyDraft = {
        kind: 'company',
        name: hit.name,
        website: hit.website,
        domain,
        country: hit.country,
        city: hit.city,
        industry: hit.industry,
        size: hit.size,
        source: 'apollo',
        ref: query.text,
      };
      yield company;
      if (person.email) {
        const contact: ContactDraft = {
          kind: 'contact',
          companyDomain: domain,
          companyName: hit.name,
          name: person.name,
          title: person.title,
          email: person.email,
          emailConfidence: 'verified',
          source: 'apollo',
        };
        yield contact;
      }
    }
  },
};
