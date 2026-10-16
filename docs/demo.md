# Demo

The user types **one URL**. Everything else runs on its own; the presenter only confirms at the two checkpoints. In `FAKE_MAIL=true` mode, sends, opens, clicks and replies are simulated deterministically through the real tracking and reply code paths (`packages/mail/src/fake.ts`), so the whole lifecycle fits in four minutes with zero paid dependencies. Profiling, prospecting, scoring, copywriting and chat run live.

## 4-minute script

| Time | What happens | What to say |
|---|---|---|
| 0:00–0:15 | Hook slide | "Outbound sales in APAC means 10 languages, strict rules and hours of research per lead. Sutra turns a website URL into a running, compliant, self-optimising campaign." |
| 0:15–0:55 | Type `pixelpress.sg` → the **agent graph** lights up: Profiler → Crawler · Web research · ICP builder. The **Business tab fills in live**: offerings, proof points, customers, ICP, 2 personas. | "It read our site and the web, and every claim links to its source." |
| 0:55–1:10 | **Checkpoint 1.** In chat: *"Focus on Indonesia and Vietnam, skip enterprises."* The ICP updates (confirm card) → **Confirm**. | "One sentence in chat to steer it. Then one confirmation." |
| 1:10–1:50 | Graph: Prospector **fans out** into Search · Lookalike · Places · Registry, with live counts. The **Prospects tab** fills; Enricher scores rows with reasons. | "Several free sources at once. Lookalikes come from our own customers. Every score is explained." |
| 1:50–2:20 | Copywriter runs → **Campaigns tab**: a 3-step sequence, A/B variants per step with hypotheses; switch the preview to Bahasa and Vietnamese. | "Each A/B pair tests one idea, and it's localised with the right formality." |
| 2:20–2:40 | **Checkpoint 2**: compliance report ("212 ready · 9 blocked…"), schedule per timezone, warm-up ramp → **Approve**. | "Nothing is sent without approval and a compliance check." |
| 2:40–3:20 | Fast clock: sends go out, then replies arrive. The **Leads tab** cards update: Interested · Not interested · Meeting booked. Open a Bahasa reply: English summary, intent, slots in WIB. | "Replies in any language are understood and sorted. Meetings are booked on the calendar." |
| 3:20–3:45 | Campaigns tab: variant B leading (P(best) ~88%); **"Suggested variants (1)"**: the optimizer proposes a challenger with its reasoning → approve. | "It learns what works and proposes better copy. A person still approves every new variant." |
| 3:45–4:00 | Close: architecture slide + eval scores + "$0 on free tiers". | "ADK multi-agents, Gemini, Cloud Run, Cloud Tasks, Pub/Sub, Secret Manager. Compliant by design, built for APAC." |

The pre-seeded campaign (`pnpm db:seed --demo`) supplies the week of A/B history behind the Campaigns and Leads tabs, so the stats, the leading variant and the optimizer challenger are realistic from the first second. The live run the presenter kicks off adds a second campaign on top.

## 30 minutes before presenting

- [ ] `pnpm warmup`; check the Gemini and Places quotas in the console
- [ ] Reset the demo workspace: `pnpm db:seed --demo --owner=you@example.com`
- [ ] Full dry run with `pixelpress.sg` (or your chosen site), so crawl and research caches are warm
- [ ] Have the recorded-run replay (PR 17 fixture, `apps/web/app/fixtures/agent-graph`) and a backup video ready

## Submission checklist

- [ ] Live URL + test login for judges
- [ ] 3–4 min demo video (from the script above)
- [ ] Architecture diagram (from [`todo/README.md`](../todo/README.md) section 2) exported as PNG
- [ ] Root README: problem, solution, Google Cloud services, how to run, eval results, "$0 on free tiers" — done
- [ ] Pitch deck: problem → demo → architecture → compliance → A/B results → roadmap

## Why it's bulletproof

- **Deterministic**: the seed RNG and the `FAKE_MAIL` simulator are seeded, so every reset looks the same and the lifecycle plays out identically.
- **No paid dependency in the loop**: `FAKE_MAIL` means no real mailbox, and the recorded-run replay covers a network/quota failure.
- **Acceptance**: the demo script runs end to end three times in a row without intervention.
