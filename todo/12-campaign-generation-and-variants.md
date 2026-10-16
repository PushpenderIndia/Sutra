# PR 12 — Campaign generation and A/B variants

**Branch:** `feat/12-campaign-generation-and-variants` · **Depends on:** 09, 11 · **Size:** M

## Why
Generate the whole outreach sequence automatically, with **A/B variants for each step**, personalised per contact in their language and grounded in research. It shows in the **Campaigns** tab ready for approval.

## Agents (the `copywriter` node)

### `sequencePlanner` (`sutra-smart`)
Profile + ICP + persona → the sequence shape:
```ts
export const sequencePlan = z.object({
  steps: z.array(z.object({
    delayDays: z.number().int().min(0).max(14),
    intent: z.enum(['intro', 'value', 'social_proof', 'case_study', 'objection', 'breakup']),
    angle: z.string().max(160),               // e.g. "save ops hours with automated dispatch"
  })).min(2).max(5),
  rationale: z.string().max(400),
});
```
- One campaign per persona by default (different pains mean different sequences)

### `variantWriter` (`sutra-smart`)
For each step, writes **2 template variants** that differ in **one dimension** (subject style, opening hook, CTA or length), so results are interpretable:
```ts
export const variant = z.object({
  hypothesis: z.string().max(160),            // "a question-style subject beats a statement"
  dimension: z.enum(['subject', 'hook', 'cta', 'length', 'tone']),
  subject: z.string().max(80),                // with merge fields
  body: z.string(),                           // Markdown with merge fields + {{personalization}} slot
});
```
- **Merge fields:** `{{firstName}}`, `{{company}}`, `{{personalization}}`, `{{senderName}}`
- **Per-contact personalisation:** at send time, `sutra-fast` writes the `{{personalization}}` line (1–2 sentences) from that contact's research signals, in the contact's locale, citing a source. The template itself stays fixed, so A/B comparisons stay fair.
- **Localisation:** templates are written once in English, then **translated per locale** by `sutra-smart` with locale rule fragments (Japanese keigo, Indonesian "Bapak/Ibu", Hindi आप). The reviewer sees each translation with an English gloss.

### `qualityGate` (deterministic)
- Grounding: personalisation claims must cite URLs present in the company's research
- Spam lint: trigger words, too many links, ALL CAPS, missing CTA, over 150 words
- Merge fields valid; subject under 80 characters
- On failure: one regeneration with the gate's reasons, otherwise flagged for the reviewer

## Campaigns tab
- Left: campaign list (one per persona). Status: `draft → pending_approval → running …`
- Main: a **vertical step timeline**, each step showing its variant cards side by side (A | B) with subject, body preview, hypothesis and dimension chip
- Each variant card: **Edit** (inline), **Regenerate with note**, a locale switcher (preview the Bahasa / Japanese versions), and a preview rendered for a real sample contact
- Stats appear on each card once running (PR 15): sent, replies, clicks, opens≈, P(best)

## Tasks
- [ ] `sequencePlanner`, `variantWriter`, translation step, `qualityGate`
- [ ] Per-contact personalisation at send time (cached per contact + step)
- [ ] `copywriter` pipeline node
- [ ] Campaigns tab: timeline, variant cards, editor, locale preview, sample-contact preview
- [ ] Eval fixtures: 10 profiles × 3 locales, rubric-graded (PR 18)

## Acceptance criteria
- After prospecting, a full sequence with 2 variants per step appears without any user action
- The two variants of a step differ in exactly the declared dimension (LLM-judge check in evals)
- Previewing a variant for an Indonesian contact shows Bahasa text with a personalisation line citing a real source
