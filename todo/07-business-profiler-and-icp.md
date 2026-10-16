# PR 07 — Business profiler and ICP (checkpoint 1)

**Branch:** `feat/07-business-profiler-and-icp` · **Depends on:** 05, 06 · **Size:** M

## Why
From **one input**, the website URL, Sutra learns what the user sells, who buys it and why. That becomes the brief every later agent uses. The user confirms or edits it once (**checkpoint 1**).

## Agents (the `profiler` node and its children)

### 1. `crawler` (deterministic tool, not an LLM)
- Fetch the homepage, then up to ~12 same-domain pages ranked by URL hints: `/about, /product(s), /services, /solutions, /pricing, /customers, /case-studies, /blog (latest 2), /careers, /contact`
- Respects `robots.txt`; 10s timeout per page; max 1.5 MB total
- HTML → clean text with `@mozilla/readability` + `linkedom`; keeps page title, headings, meta description, Open Graph tags, `<img alt>` of logo walls (customer logos)
- Fallback for JS-only sites: Gemini `url_context` tool on the homepage
- Output is cached per domain for 7 days

### 2. `webResearch` (Gemini direct + `google_search` grounding)
Searches for what the site doesn't say: news, funding, reviews, competitors, market and geography. Every fact keeps its `sourceUrl`.

### 3. `profileWriter` (`sutra-smart`)
Crawl text + research → **business profile**:
```ts
export const businessProfile = z.object({
  name: z.string(), website: z.url(), oneLiner: z.string().max(160),
  offerings: z.array(z.object({ name: z.string(), description: z.string(), pricingHint: z.string().optional() })).max(8),
  proofPoints: z.array(z.object({ text: z.string(), sourceUrl: z.url() })).max(8),     // metrics, awards, case studies
  customers: z.array(z.object({ name: z.string(), domain: z.string().optional(), sourceUrl: z.url() })).max(30),  // seeds for lookalikes
  geographies: z.array(country), differentiators: z.array(z.string()).max(6),
  competitors: z.array(z.object({ name: z.string(), domain: z.string().optional() })).max(8),
  toneOfVoice: z.string().max(200),
  sources: z.array(z.url()).min(1),
});
```

### 4. `icpBuilder` (`sutra-smart`)
Profile → **ICP and buyer personas**:
```ts
export const icp = z.object({
  firmographics: z.object({
    industries: z.array(z.string()).min(1).max(8), sizes: z.array(z.enum(['1-10','11-50','51-200','201-1000','1000+'])),
    countries: z.array(country).min(1), keywords: z.array(z.string()).max(15), technologies: z.array(z.string()).max(10),
  }),
  personas: z.array(z.object({
    title: z.string(), altTitles: z.array(z.string()).max(6), seniority: z.enum(['owner','c_level','vp','director','manager','ic']),
    pains: z.array(z.string()).max(5), goals: z.array(z.string()).max(5), objections: z.array(z.string()).max(5),
  })).min(1).max(4),
  buyingSignals: z.array(z.string()).max(8),         // "hiring SDRs", "opened new outlet", "raised Series A"
  disqualifiers: z.array(z.string()).max(8),
  rationale: z.string().max(600),                    // why this ICP, citing proof points and customers
});
```
- **Grounding rule:** the ICP must be explainable from the profile. If `customers[]` exist, their industries and countries must appear in the ICP, or the rationale must explain why not.

## Checkpoint 1: Business tab
- While running, sections fill in **progressively** as each sub-agent finishes (skeleton → content), so the user watches the profile being built
- When done, a `<Checkpoint>` banner appears: **"Here's what we learned about PixelPress. Confirm or edit."**
- Every section is an `<EditableCard>` (profile, offerings, proof points, customers, ICP, each persona). Edits are saved as a new `version`.
- **Chat edits work too** (PR 16): "We don't sell to restaurants anymore", "add Vietnam", "our main buyer is the head of operations"
- **Confirm** (owner/admin) sets status to `confirmed` and resumes the pipeline (PR 06), which starts prospecting
- Editing the ICP after confirmation asks: "Re-run prospecting with the new ICP?"

## Tasks
- [ ] `crawler` tool (fetch, robots, readability, page ranking, cache)
- [ ] `webResearch`, `profileWriter`, `icpBuilder` agents
- [ ] Profiler pipeline node with progressive saves
- [ ] Business tab: editable cards, version history, checkpoint banner, confirm action
- [ ] Fixtures: 5 real-world style websites (SaaS, agency, logistics, F&B supplier, edtech) for tests and evals

## Acceptance criteria
- From a URL alone, a full profile + ICP appears in under 90 seconds on the free tier
- Every proof point and customer links to a real page
- Confirming resumes the pipeline; nothing downstream starts before confirmation (tested)
