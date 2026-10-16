import type { CompanyDraft, Icp } from '@sutra/domain';
import type { CompanyHit } from '../clients.ts';
import type { LeadSource, SourceContext } from '../types.ts';

/** Turns a search hit into a company draft tagged with the source and the query it came from. */
export function hitToDraft(
  hit: CompanyHit,
  opts: { source: CompanyDraft['source']; ref: string; resembles?: string },
): CompanyDraft {
  return {
    kind: 'company',
    name: hit.name,
    website: hit.website,
    domain: hit.domain,
    country: hit.country,
    city: hit.city,
    industry: hit.industry,
    size: hit.size,
    description: hit.description,
    sourceUrl: hit.sourceUrl,
    source: opts.source,
    ref: opts.ref,
    ...(opts.resembles && { resembles: opts.resembles }),
  };
}

/** Pairs each ICP country with each industry, highest-signal buying trigger first. */
export function industryCountryQueries(icp: Icp): { text: string; country: string }[] {
  const { industries, countries } = icp.firmographics;
  const signal = icp.buyingSignals[0];
  const queries: { text: string; country: string }[] = [];
  for (const country of countries)
    for (const industry of industries)
      queries.push({
        text: `${industry} companies in ${country}${signal ? ` ${signal}` : ''}`,
        country,
      });
  return queries;
}

/**
 * `search`: Gemini + Google Search grounding. Queries come straight from the ICP — one per
 * (country, industry) pair, biased by the top buying signal — and the model extracts structured
 * companies with source URLs.
 */
export const searchSource: LeadSource = {
  id: 'search',
  label: 'Search',
  cost: 'quota',
  enabled: (ctx) => ctx.enabledSources.includes('search'),
  plan: (icp) =>
    industryCountryQueries(icp).map(({ text, country }) => ({ source: 'search', text, country })),
  async *fetch(ctx: SourceContext, query) {
    const hits = await ctx.clients.search.find(query.text, {
      limit: query.limit ?? ctx.budget.maxResults,
    });
    for (const hit of hits) yield hitToDraft(hit, { source: 'search', ref: query.text });
  },
};
