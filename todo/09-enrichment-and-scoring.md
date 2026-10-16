# PR 09 — Enrichment and scoring

**Branch:** `feat/09-enrichment-and-scoring` · **Depends on:** 08 · **Size:** M

## Why
Contact only prospects worth contacting, and give the copywriter grounded, cited facts about each one.

## Agents (the `enricher` node)

### `researcher` (Gemini direct, `google_search` + `url_context`)
Per company. Output:
```ts
export const companyResearch = z.object({
  summary: z.string().max(600),
  signals: z.array(z.object({
    kind: z.enum(['hiring', 'funding', 'expansion', 'launch', 'pain_point', 'tech_stack', 'news', 'other']),
    text: z.string(), sourceUrl: z.url(), date: z.string().optional(),
  })).max(10),
  matchedIcpSignals: z.array(z.string()),      // which ICP buyingSignals were observed
  websiteLanguage: locale.optional(),
  sources: z.array(z.url()).min(1),
});
```
- Every signal **must** carry a `sourceUrl`; validation rejects outputs that don't.
- Web content is untrusted (the PR 06 guard).
- Cached for 30 days per company; only runs after the pre-filter passes, which protects the free grounding quota.

### `scorer` (`sutra-fast`)
Inputs: research, ICP and persona match. Output:
```ts
export const prospectScore = z.object({
  score: z.number().int().min(0).max(100),
  fit: z.enum(['strong', 'medium', 'weak', 'disqualified']),
  reasons: z.array(z.object({ text: z.string(), weight: z.number(), evidence: z.string() })).max(6),
});
```
- **Deterministic pre-filter first:** country not in the ICP, a disqualifier keyword, or a suppressed domain means `disqualified` with no LLM call
- Blend: `final = 0.6 * llm + 0.4 * rules`. Rules: persona match quality, email confidence, number of sources that found the company, ICP signals matched. Weights are config.

## Contact locale and timezone
- `locale` comes from the website language, then the country default (data map), and can be overridden in chat
- `timezone` comes from the city or country
- Both drive the copywriter's language and the send schedule

## Pipeline
`enrich` node: for each company (job queue, concurrency limit, per-run budget) → `contactFinder` (PR 08) → `researcher` → `scorer` → update → audit. The pipeline moves to the copywriter once every company is scored, or after a time budget with partial results.

## UI (Prospects tab additions)
- Score column with a fit badge; row expands to the research card (signals with source chips, score reasons)
- "Strong fit" quick filter; the default campaign audience is strong + medium

## Tasks
- [ ] Schemas in `@sutra/domain`
- [ ] `researcher`, `scorer` via `defineAgent`
- [ ] Pre-filter + blend
- [ ] `enrich` pipeline node with budgets
- [ ] Research card UI
- [ ] Golden eval set: 20 fixture companies with expected `fit` (run in PR 18)

## Acceptance criteria
- Every research signal links to a real URL
- A disqualified prospect uses 0 LLM tokens (tested)
- Score reasons are specific and cite evidence
