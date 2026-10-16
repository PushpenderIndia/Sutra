import type { BusinessProfile, Icp, LeadDraft } from '@sutra/domain';
import type { LeadSource, SourceContext } from './types.ts';

/** The default per-run budget, kept well under the free-tier quotas. */
export const DEFAULT_BUDGET = { maxQueries: 6, maxResults: 30 } as const;

/**
 * Plans a source's queries from the ICP and streams its drafts, staying inside the budget: at most
 * `maxQueries` queries and `maxResults` drafts in total. A generator, so the caller can upsert and
 * report progress as results arrive rather than buffering everything.
 */
export async function* collectLeads(
  source: LeadSource,
  ctx: SourceContext,
  icp: Icp,
  profile: BusinessProfile,
): AsyncIterable<LeadDraft> {
  const queries = source.plan(icp, profile).slice(0, ctx.budget.maxQueries);
  let produced = 0;
  for (const query of queries) {
    if (produced >= ctx.budget.maxResults) return;
    for await (const draft of source.fetch(ctx, query)) {
      yield draft;
      if (++produced >= ctx.budget.maxResults) return;
    }
  }
}
