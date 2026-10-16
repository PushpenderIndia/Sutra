import type { LeadSource } from '../types.ts';
import { hitToDraft } from './search.ts';

/**
 * `lookalike`: for each of the user's own customers (from the business profile), search for similar
 * companies in the ICP's countries. Every result records which customer it resembles, shown later
 * as a reason, so the fan-out stays explainable.
 */
export const lookalikeSource: LeadSource = {
  id: 'lookalike',
  label: 'Lookalike',
  cost: 'quota',
  enabled: (ctx) => ctx.enabledSources.includes('lookalike'),
  plan(icp, profile) {
    const countries = icp.firmographics.countries.slice(0, 2);
    return profile.customers.flatMap((customer) =>
      countries.map((country) => ({
        source: 'lookalike' as const,
        text: `companies like ${customer.name} in ${country}`,
        resembles: customer.name,
        country,
      })),
    );
  },
  async *fetch(ctx, query) {
    const hits = await ctx.clients.search.find(query.text, {
      limit: query.limit ?? ctx.budget.maxResults,
    });
    for (const hit of hits)
      yield hitToDraft(hit, { source: 'lookalike', ref: query.text, resembles: query.resembles });
  },
};
