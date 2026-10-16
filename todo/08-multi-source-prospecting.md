# PR 08 — Multi-source prospecting

**Branch:** `feat/08-multi-source-prospecting` · **Depends on:** 07 · **Size:** L

## Why
Find companies that match the ICP from **several sources**, merge and dedupe them, and find the right people to contact. Each source is a sub-agent in the graph, so judges see the prospector fan out.

## One interface (`@sutra/sources`)

```ts
export interface LeadSource {
  id: Source;                                       // 'search' | 'lookalike' | 'places' | 'registry' | 'csv' | 'apollo' | 'hunter'
  label: string;
  cost: 'free' | 'quota' | 'paid';
  enabled(ctx): boolean;                            // flags, credentials, ICP fit (e.g. places only for local businesses)
  plan(icp: Icp, profile: BusinessProfile): Query[];   // turn the ICP into concrete queries
  fetch(ctx, query: Query): AsyncIterable<CompanyDraft | ContactDraft>;
}
```
The `prospector` node fans out over `enabledSources` (PR 06), runs each with a **per-run budget** (max queries, max results), and streams drafts into `normalize → dedupe → upsert`.

## Sources

| Source | How it works | Cost |
|---|---|---|
| **`search`** | Gemini + Google Search grounding. Queries come from the ICP: `"{industry} companies in {city/country} {signal}"`, e.g. "logistics companies in Vietnam hiring sales staff". The model extracts structured companies with source URLs. | Free quota |
| **`lookalike`** | For each of the user's `customers[]` (from PR 07): find similar companies via search ("companies like X in Y", competitors of X, same category directories). Each result records **which customer it resembles** (shown as a reason). | Free quota |
| **`places`** | Google Places Text Search for local-business ICPs (cafés, clinics, retailers). Grid search over the city; the PR 02 quota guard applies. | Free cap |
| **`registry`** | Open company registries where available. Each country is an adapter (start with Singapore's open data on data.gov.sg; add others later). Verify each dataset's licence when adding it. | Free |
| **`csv`** | Upload with an AI-guessed column mapping and a per-row error report | Free |
| **`apollo`** *(optional)* | People and company search by ICP filters (titles, industries, sizes, countries) | **Paid / freemium**; workspace provides its own API key |
| **`hunter`** *(optional)* | Domain search and email finder for contacts at found companies | **Paid / freemium**; workspace API key |

- Optional sources only appear when `FEATURE_PAID_SOURCES=true` **and** the workspace adds an API key (stored encrypted via `credentials`). They're off by default.
- **No LinkedIn scraping.** It breaks LinkedIn's terms of service and the compliance story.

## Normalise and dedupe
- `domain` from the website (`new URL().hostname`, strip `www.`), with a fallback match on `normalizedName + country`
- `companies(workspaceId, domain)` unique index; each company keeps `sources[]` (one company can come from 3 sources, which is shown as "found by 3 sources" and boosts confidence)
- Country, city and timezone resolved from address or registry data

## Contact discovery (`contactFinder`, also used in PR 09)
For each company without contacts from a paid source:
1. **Website pages**: crawl `/contact, /about, /team, /leadership` (the PR 07 crawler); `sutra-fast` extracts `{name, title, email?}`
2. **Persona match**: map titles to ICP personas (exact, alt-titles, or LLM fuzzy match) → `personaMatch`
3. **Email**:
   - published on the site → `emailConfidence: 'verified'`
   - otherwise guess common patterns (`first@`, `first.last@`, `flast@`), checked against the domain's mail server (MX) records → `'pattern'`
   - generic inbox (`info@`, `hello@`) → `'role'` (allowed; lower score)
   - No SMTP probing: it's unreliable, looks like spam, and port 25 is blocked on Cloud Run anyway
4. Paid sources' emails keep their provider's confidence

## Prospects tab
- `<DataTable>`: company, contact, title, persona, email confidence, sources (chips), score (PR 09), compliance status (PR 10)
- Live: rows appear as each source finds them; source chips animate in
- Bulk actions: exclude, re-enrich, add to campaign. A chat command can do the same (PR 16).

## Tasks
- [ ] `LeadSource` interface + `search`, `lookalike`, `places`, `registry` (SG), `csv`
- [ ] `apollo`, `hunter` adapters behind the flag + credentials UI
- [ ] Query planner from ICP, per-run budgets
- [ ] Normalise, dedupe, multi-source merge
- [ ] `contactFinder` with persona match and email confidence
- [ ] Prospects tab
- [ ] Fake sources (fixtures) for tests and demo mode

## Acceptance criteria
- A confirmed ICP produces prospects from at least 3 free sources with zero duplicate companies
- Every company records its sources; every contact has an email confidence
- Optional sources never run without the flag and a workspace key (tested)
- A run stays inside its query budget (tested)
