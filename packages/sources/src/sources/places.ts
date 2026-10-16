import type { CompanyDraft, Icp } from '@sutra/domain';
import type { LeadSource } from '../types.ts';

/** Industry words that mark an ICP as local, bricks-and-mortar businesses Places can find. */
const LOCAL_WORDS =
  /\b(cafe|café|coffee|restaurant|bakery|bar|beverage|clinic|dental|salon|spa|retail|shop|store|hotel|gym|grocer|hawker|food|dessert|juice|eatery)\b/i;

/** True when the ICP looks like local businesses (so Places is worth the quota). */
export const isLocalBusinessIcp = (icp: Icp): boolean =>
  icp.firmographics.industries.some((industry) => LOCAL_WORDS.test(industry)) ||
  icp.firmographics.keywords.some((keyword) => LOCAL_WORDS.test(keyword));

/**
 * `places`: Google Places Text Search for local-business ICPs. One text query per (industry,
 * country); the PR 02 monthly quota guard (applied by the real client) caps spend under the free
 * tier. Only runs when the ICP is clearly local.
 */
export const placesSource: LeadSource = {
  id: 'places',
  label: 'Places',
  cost: 'quota',
  enabled: (ctx) => ctx.enabledSources.includes('places'),
  plan(icp) {
    if (!isLocalBusinessIcp(icp)) return [];
    const { industries, countries } = icp.firmographics;
    return countries.flatMap((country) =>
      industries
        .filter((industry) => LOCAL_WORDS.test(industry))
        .map((industry) => ({
          source: 'places' as const,
          text: `${industry} in ${country}`,
          country,
        })),
    );
  },
  async *fetch(ctx, query) {
    const results = await ctx.clients.places.textSearch(query.text, {
      limit: query.limit ?? ctx.budget.maxResults,
    });
    for (const place of results) {
      const draft: CompanyDraft = {
        kind: 'company',
        name: place.name,
        website: place.website,
        country: place.country ?? query.country,
        city: place.city,
        source: 'places',
        ref: place.placeId,
      };
      yield draft;
    }
  },
};
