# Sutra

> **Sutra** (सूत्र, "thread") — one thread from first touch to closed deal.

Sutra is an AI outbound-sales workspace. Paste your website and Sutra learns your business, finds your ideal customers across several sources, writes and A/B-tests multi-step outreach, sends it from your own Gmail, and books meetings — with a person approving the business profile and the campaign before anything is sent. It runs on Google Cloud free tiers with Gemini, Google ADK agents and MongoDB Atlas.

## Quick start

Requires Node 22 and pnpm 10.

```sh
pnpm i
pnpm secrets:pull            # or: cp .env.example .env.local
docker compose -f infra/docker-compose.yml up -d   # local MongoDB + LiteLLM proxy (needs GEMINI_API_KEY)
pnpm db:migrate              # collections, validators, indexes
pnpm db:seed --demo          # optional: demo workspace with a running campaign
pnpm dev                     # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run the app in dev mode |
| `pnpm build` | Production build |
| `pnpm lint` / `pnpm format` | Biome check / fix |
| `pnpm typecheck` | TypeScript across every workspace |
| `pnpm test` | Vitest across every workspace (DB tests use an in-memory MongoDB); `pnpm test --coverage` enforces 100% on `packages/compliance` |
| `pnpm db:migrate` | Create collections with Zod-generated `$jsonSchema` validators and indexes (idempotent) |
| `pnpm db:seed --demo [--owner=you@example.com]` | Reset the demo workspace to a mid-campaign state; `--owner` (a user who has signed in once) makes you its owner |
| `pnpm deploy:prod` | `secrets:check` → build → submit Cloud Build (test, build + push both images, deploy both Cloud Run services, migrate) |
| `pnpm warmup` | Hit each service's health endpoint so the min-instances-0 services are warm before judging |
| `pnpm agent:try <agent> "<input>"` | Run one agent through the LiteLLM proxy in a Mongo session (`--session key` to resume) |
| `pnpm secrets:pull` / `push` / `check` / `example` | Manage the `SUTRA_ENV` secret ([docs/secrets.md](docs/secrets.md)) |
| `pnpm i18n:translate [locale…]` | Fill missing UI strings in `apps/web/messages/*.json` from English with Gemini |

## Auth and workspaces

Sign-in is Google only (Better Auth). A workspace is a Better Auth organization with roles `owner`, `admin` and `member`; onboarding asks one question, the company website, and creates the workspace. Every Server Action is defined with `action()` / `userAction()` and every route handler with `route()` from `apps/web/lib/action.ts` (session → active workspace → role → Zod input); a test fails on any that isn't. Webhooks and jobs verify signatures with `apps/web/lib/verify.ts` instead. Google refresh tokens are kept only in `credentials`, encrypted.

For local sign-in, create an OAuth client (Web) in Google Cloud with redirect URI `http://localhost:3000/api/auth/callback/google` and put its ID and secret in `.env.local`.

## App shell

One screen: the live agent graph in the top bar, four tabs (Business · Prospects · Campaigns · Leads, each a route under `apps/web/app/(app)/`) on the left, and the copilot chat on the right (resizable and collapsible; a bottom sheet on mobile). The UI uses shadcn/ui on Tailwind 4 with light and dark themes, TanStack Table behind one `<DataTable>`, TanStack Query for live data, and next-intl for UI strings (`en`, `hi`, `id`; the language is a cookie, separate from each contact's content language). `useSelection()` holds the current tab and selected rows, so the chat knows what "this" refers to. Press ⌘K for the command menu.

## Layout

```
apps/web            Next.js app (UI, API, webhooks, jobs, agents runtime)
packages/config     env + secrets (the only reader of process.env)
packages/domain     Zod schemas, enums, pure helpers
packages/db         MongoDB client and repositories
packages/agents     ADK agents, LiteLLM adapter, runner, prompts, safety, pipeline engine
packages/sources    lead sources
packages/mail       Gmail send, threading, tracking
packages/compliance policy engine + country rule packs (docs/compliance.md)
```

Agents name model aliases (`sutra-fast`, `sutra-smart`) that [`infra/litellm/config.yaml`](infra/litellm/config.yaml) maps to providers, so changing a model is a YAML edit.

Internal packages export TypeScript source directly (no build step); the app compiles them via `transpilePackages`. The build plan lives in [`todo/`](todo/README.md).

## Problem and solution

Outbound sales in APAC means ten languages, strict per-country rules and hours of research per lead. Sutra turns a single website URL into a running, compliant, self-optimising campaign: it researches the business, builds the ICP and personas, prospects from several free sources, scores and enriches every contact, writes and A/B-tests a localised multi-step sequence, sends from the user's own Gmail within warm-up and timezone limits, understands replies in any language, books meetings, and proposes better copy as it learns — with a person approving the business profile and the campaign before anything goes out.

## Google Cloud services

| Service | Role in Sutra |
|---|---|
| **Cloud Run** (`us-central1`, min instances 0) | `sutra-web` (Next.js: UI, API, webhooks, jobs, tracking, ADK runner — public) and `sutra-litellm` (LiteLLM proxy — gated by its master key) |
| **Gemini API** (AI Studio, free tier) | Flash-Lite (`sutra-fast`) and Flash (`sutra-smart`) via LiteLLM; Google Search grounding for research |
| **Secret Manager** | One secret, `SUTRA_ENV`, mounted as `/secrets/.env` in both services |
| **Artifact Registry** | `web` and `litellm` images; cleanup policy keeps only the latest |
| **Cloud Tasks** | `sutra-jobs` queue — scheduled sends and pipeline jobs without an always-on worker |
| **Cloud Scheduler** | One daily `maintenance` cron (watch renewal, due-step sweep, retention, optimizer) |
| **Pub/Sub** | Gmail push → `/api/webhooks/gmail` (OIDC) for real-time replies |
| **Places API (New)** | A prospecting source, quota-guarded under the free monthly cap |
| **Gmail + Calendar APIs** | Send from the user's mailbox; book meetings |
| **Cloud Logging / Trace / Monitoring** | Structured logs, per-run traces and metrics (PR 18) |
| **MongoDB Atlas M0** | Free cluster near `us-central1` (native driver + Zod; ADK sessions too) |

See the architecture diagram and the free-tier table in [`todo/README.md`](todo/README.md) sections 2 and 5.

## Deploy to Google Cloud

One root Terraform module in [`infra/terraform/`](infra/terraform/) provisions everything above; [`infra/cloudbuild.yaml`](infra/cloudbuild.yaml) tests, builds both images, deploys both services and migrates. Full walkthrough: [`docs/deploy.md`](docs/deploy.md).

```sh
# 0. Out-of-band (both free): create a MongoDB Atlas M0 cluster, and a Gemini API key in a
#    SEPARATE project with no billing. Put MONGODB_URI and GEMINI_API_KEY in .env.local.

cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # set project_id, app_url
terraform init && terraform apply               # Cloud Run, Secret Manager, Tasks, Scheduler, Pub/Sub, IAM, budget

cd ../..
pnpm secrets:push     # upload .env.local as the one SUTRA_ENV secret (keeps exactly one version)
pnpm deploy:prod      # secrets:check → build → Cloud Build (deploys both services + migrate)
pnpm warmup           # a minute before judging: wake the min-instances-0 services
```

A fresh GCP project reaches a working deploy with `terraform apply` + `pnpm deploy:prod`. No secret is hardcoded or baked into an image; both services read the one Secret Manager secret at boot.

## Demo

`pnpm db:seed --demo` resets a `demo` workspace to a realistic mid-campaign state — a confirmed profile/ICP, scored prospects, a week of A/B sends, replies, meetings and an optimizer challenger awaiting approval — so the A/B stats and Leads tab look real immediately. With `FAKE_MAIL=true`, sends, opens, clicks and replies are **simulated deterministically** through the same code paths real tracking and Gmail replies take (`packages/mail/src/fake.ts`), so the full lifecycle plays out live in minutes with zero paid dependencies. Profiling, prospecting, scoring, copywriting and chat still run live against the real APIs. The recorded-run replay fixture (PR 17) is the backup if the network or quotas fail.

The four-minute demo script and the 30-minutes-before checklist are in [`docs/demo.md`](docs/demo.md).

## Eval results

`pnpm eval` scores six agents offline against fixtures and a deterministic rubric judge (also run in CI); the committed report is [`packages/agents/evals/report.md`](packages/agents/evals/report.md). All targets pass: profiler and variant-writer rubrics 100% (target 90%), scorer fit accuracy 100%, reply-intent accuracy 100% across six languages, copilot tool/args/mutation checks 100%, and the A/B bandit sends 88% of traffic to the better variant with P(best) 85% (target 80%).

## Runs at $0 on free tiers

Every service sits on an always-free tier: Cloud Run in `us-central1` with min instances 0, one Secret Manager secret, one Cloud Scheduler job, Artifact Registry pruned to a single image, Gemini on a no-billing project, and MongoDB Atlas M0. A `$1` billing budget and a Places daily quota are backstops, not expected spend. The invariants are enforced by a test (`@sutra/deploy` `auditInfra`) that fails if the committed infra would leave the free tier.
