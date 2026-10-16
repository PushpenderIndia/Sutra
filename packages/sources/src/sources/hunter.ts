import type { ContactDraft } from '@sutra/domain';
import type { LeadSource } from '../types.ts';

/**
 * `hunter` (optional, paid): domain search / email finder for contacts at companies we already
 * know (the user's customers and competitors). Off unless `FEATURE_PAID_SOURCES` is on **and** the
 * workspace added its own key. It only adds contacts — never new companies.
 */
export const hunterSource: LeadSource = {
  id: 'hunter',
  label: 'Hunter',
  cost: 'paid',
  enabled: (ctx) =>
    ctx.paidSourcesEnabled && ctx.enabledSources.includes('hunter') && Boolean(ctx.keys.hunter),
  plan(_icp, profile) {
    const domains = new Set<string>();
    for (const customer of profile.customers) if (customer.domain) domains.add(customer.domain);
    for (const competitor of profile.competitors)
      if (competitor.domain) domains.add(competitor.domain);
    return [...domains].map((domain) => ({ source: 'hunter' as const, text: domain }));
  },
  async *fetch(ctx, query) {
    const domain = query.text;
    const contacts = await ctx.clients.hunter.domainSearch(domain, {
      limit: query.limit ?? ctx.budget.maxResults,
    });
    for (const contact of contacts) {
      const draft: ContactDraft = {
        kind: 'contact',
        companyDomain: domain,
        name: contact.name,
        title: contact.title,
        email: contact.email,
        emailConfidence: 'verified',
        source: 'hunter',
      };
      yield draft;
    }
  },
};
