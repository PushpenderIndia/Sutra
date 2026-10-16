# PR 19 — Deploy and demo

**Branch:** `feat/19-deploy-and-demo` · **Depends on:** all ✅ PRs · **Size:** S

## Why
The competition requires a working prototype on Google Cloud (Cloud Run). Deployment must be one command, at $0, and the demo must be bulletproof.

## Infrastructure (`infra/terraform/`, one root module)
| Resource | Notes |
|---|---|
| Artifact Registry repo | images for web and litellm; **cleanup policy keeps the latest only** (0.5 GB free) |
| Cloud Run `sutra-web` | public; **min instances 0**; 512 MiB–1 GiB; `us-central1` |
| Cloud Run `sutra-litellm` | official image + `config.yaml`, stateless; **internal ingress**; min instances 0 |
| Secret Manager | **one** secret `SUTRA_ENV`, mounted as a file in both services |
| Cloud Tasks queue `sutra-jobs` | retry policy, rate limits |
| Cloud Scheduler | **one** job: `maintenance` (daily) |
| Pub/Sub topic + push subscription | Gmail watch → `/api/webhooks/gmail` with OIDC |
| Service accounts + IAM | least privilege (PR 18) |
| Billing budget | **$1 alert**, plus daily quotas on the Places API |
| MongoDB Atlas | **M0 free cluster** on GCP near `us-central1`; IP allowlist with a strong password (M0 has no private endpoints) |
| Gemini API key | from a **separate project with no billing**, so it stays on the free tier |

- `cloudbuild.yaml` (or GitHub Actions): test → build images (Next.js `output: 'standalone'`) → push → `gcloud run deploy` → `db:migrate`
- `pnpm deploy:prod` runs `secrets:check` → build → deploy
- `pnpm warmup` hits each service's health endpoint (run a minute before judging; min instances 0 means cold starts)

## Demo mode
- A `demo` workspace with `FAKE_MAIL=true`: sends, opens, clicks and **replies are simulated** from a script on a fast clock (a "day" lasts ~20s), so the whole lifecycle fits in 4 minutes
- Profiling, prospecting, scoring, copywriting and chat run **live** against the real APIs
- `pnpm db:seed --demo` adds a second, pre-run campaign with a week of history, so A/B stats and the Leads tab look realistic
- A **recorded-run replay** (PR 17 fixture) is the backup if the network or quotas fail

## 4-minute demo script
The user types one URL. Everything else runs on its own; the presenter only confirms at the two checkpoints.

| Time | What happens | What to say |
|---|---|---|
| 0:00–0:15 | Hook slide | "Outbound sales in APAC means 10 languages, strict rules and hours of research per lead. Sutra turns a website URL into a running, compliant, self-optimising campaign." |
| 0:15–0:55 | Type `pixelpress.sg` → the **agent graph** lights up: Profiler → Crawler · Web research · ICP builder. The **Business tab fills in live**: offerings, proof points, customers, ICP, 2 personas. | "It read our site and the web, and every claim links to its source." |
| 0:55–1:10 | **Checkpoint 1.** Type in chat: *"Focus on Indonesia and Vietnam, skip enterprises."* The ICP updates (confirm card) → **Confirm**. | "One sentence in chat to steer it. Then one confirmation." |
| 1:10–1:50 | Graph: Prospector **fans out** into Search · Lookalike · Places · Registry, with live counts. The **Prospects tab** fills; Enricher scores rows with reasons. | "Several free sources at once. Lookalikes come from our own customers. Every score is explained." |
| 1:50–2:20 | Copywriter runs → **Campaigns tab**: a 3-step sequence, A/B variants per step with hypotheses; switch the preview to Bahasa and Vietnamese. | "Each A/B pair tests one idea, and it's localised with the right formality." |
| 2:20–2:40 | **Checkpoint 2**: compliance report ("212 ready · 9 blocked: 5 personal emails, 3 suppressed…"), schedule per timezone, warm-up ramp → **Approve**. | "Nothing is sent without approval and a compliance check." |
| 2:40–3:20 | Fast clock: sends go out, then replies arrive. The **Leads tab** cards update: Interested 4 · Not interested 2 · Meeting booked 1. Open a Bahasa reply: English summary, intent, slots offered in WIB. | "Replies in any language are understood and sorted. Meetings are booked on the calendar." |
| 3:20–3:45 | Campaigns tab: variant B leading (P(best) 88%); **"Suggested variants (1)"**: the optimizer proposes a challenger with its reasoning → approve. | "It learns what works and proposes better copy. A person still approves every new variant." |
| 3:45–4:00 | Close: architecture slide + eval scores + "$0 on free tiers". | "ADK multi-agents, Gemini, Cloud Run, Cloud Tasks, Pub/Sub, Secret Manager. Compliant by design, built for APAC." |

## 30 minutes before presenting
- [ ] `pnpm warmup`; check the Gemini and Places quotas
- [ ] Reset the demo workspace (`pnpm db:seed --demo`)
- [ ] Do a full dry run with `pixelpress.sg` (or your chosen demo site), so crawl and research caches are warm
- [ ] Have the recorded-run replay and a backup video ready

## Submission checklist
- [ ] Live URL + test login for judges
- [ ] 3–4 min demo video (from the script above)
- [ ] Architecture diagram (from `todo/README.md`) exported as PNG
- [ ] Root README: problem, solution, Google Cloud services used, how to run, eval results, "runs at $0 on free tiers"
- [ ] Pitch deck: problem → demo → architecture → compliance → A/B results → roadmap

## Acceptance criteria
- A fresh GCP project reaches a working deploy with `terraform apply` + `pnpm deploy:prod`
- The demo script runs end to end three times in a row without intervention
