import type { Country } from '@sutra/domain';
import type { LeadSource } from '../types.ts';
import { hitToDraft } from './search.ts';

/**
 * `registry`: open company registries, one adapter per country (Singapore's data.gov.sg first).
 * Only plans queries for countries the registry client actually covers; licences are verified per
 * dataset when an adapter is added.
 */
export const registrySource: LeadSource = {
  id: 'registry',
  label: 'Registry',
  cost: 'free',
  enabled: (ctx) => ctx.enabledSources.includes('registry'),
  plan(icp, _profile) {
    const { industries } = icp.firmographics;
    return icp.firmographics.countries.flatMap((country) =>
      industries.map((industry) => ({
        source: 'registry' as const,
        text: industry,
        country,
      })),
    );
  },
  async *fetch(ctx, query) {
    const country = query.country as Country | undefined;
    if (!country || !ctx.clients.registry.countries.includes(country)) return;
    const hits = await ctx.clients.registry.search(query.text, {
      country,
      limit: query.limit ?? ctx.budget.maxResults,
    });
    for (const hit of hits)
      yield hitToDraft(hit, { source: 'registry', ref: `${country}:${query.text}` });
  },
};
