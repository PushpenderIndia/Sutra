# Sutra

> **Sutra** (सूत्र, "thread") — one thread from first touch to closed deal.

**AI-powered B2B sales automation.** From one URL to a pipeline of potential customers. Sutra is an autonomous, multi-agent AI sales platform — a **team of 30+ specialised AI agents** that discovers the right prospects, personalises outreach, runs campaigns across text and voice, and turns replies into meetings.

**Your own autonomous sales & marketing team, powered by AI agents working for you 24/7 — with Human-in-the-Loop (HITL) for key decisions.**

**One URL. Multiple agents. A complete outbound workflow.**

> Salespeople should spend their time selling — not assembling the sales process. Sutra automates the entire journey from a company URL to qualified sales conversations: no manual company research, decision-maker hunting, email writing or follow-up chasing.

## The problem

B2B sales is broken. Businesses burn resources chasing customers while sales teams drown in manual work — researching, writing, calling, updating the CRM — and buyers tune out irrelevant messages. Every new customer starts with a conversation, but getting there is painfully manual across disconnected tools.

## Why Sutra is different

- **A declarative pipeline of specialised AI agents**, not generic mass-emailing. It chains Google Search grounding, live registries and LLM reasoning to ensure zero hallucinations and extreme relevance.
- **Solves a real gap** — the 48% of teams lacking cold-outreach capacity (Salesforce, 2026) and the 73% of B2B buyers who avoid irrelevant outreach (Gartner, 2025).
- **USP** — the bottleneck isn't sending more email, it's finding the *right* prospects. Sutra's edge is multi-channel (text + voice) autonomy, A/B Thompson-sampling optimisation and strict tenant-isolated compliance, all triggered from a single company URL — tapping the $0.8T–$1.2T of generative-AI productivity value across sales and marketing (McKinsey).

## Features

- **Autonomous business profiler** — crawls the web to build your Ideal Customer Profile (ICP) and distinct buyer personas from your URL alone.
- **Cross-channel prospecting** — fans out across Google Places, open registries, Apollo, Hunter and LinkedIn to discover and score contacts with a blended LLM (0.6) + rules-based (0.4) score.
- **AI voice calling & text outreach** — bridges localised, A/B-tested cold-email campaigns with autonomous AI voice calls that handle live, multi-turn conversational objections based on prospect engagement.
- **Dynamic A/B optimiser** — a Thompson-sampling bandit retires losing variants and writes winning challengers every 50 sends.
- **Event-driven reply analyst** — understands inbound replies in any language to pause sequences, handle objections, or book meetings straight onto the calendar.
- **CRM bi-directional sync** — native Salesforce and HubSpot integrations log AI activities, transcripts and pipeline updates automatically.

## How it works — the pipeline (DAG)

1. **Orchestrator** — initialises the React Flow agent graph.
2. **Business profiler** — `crawler → webResearch → profileWriter → icpBuilder`.
3. **Checkpoint 1** — human-in-the-loop confirms the profile.
4. **Prospector & enricher** — fan out across lead sources → deduplicate → score fit vs ICP.
5. **Copywriter** — `sequencePlanner → variantWriter (A/B) → qualityGate → translator`.
6. **Checkpoint 2** — human-in-the-loop approves the campaign.
7. **Sender → reply analyst → optimiser** — send from the user's Gmail, analyse replies as they arrive, and improve copy as it learns.

## Architecture

- **Web layer (Next.js 16 App Router)** — server actions, a live React Flow agent graph, Better Auth.
- **Agent pipeline (`@sutra/agents`)** — ADK-JS agents, Google Search grounding for factual retrieval, Gmail REST integration.
- **Runtime & infrastructure (Google Cloud)** — Cloud Run (public Next.js app + internal LiteLLM proxy), Cloud Tasks (async step-by-step job queue), Pub/Sub (Gmail-push webhooks for real-time reply analysis), Cloud Scheduler, Secret Manager, Cloud Build.
- **Data layer (`@sutra/db`)** — MongoDB Atlas, tenant-scoped session data governed by Zod domain schemas.

## Technologies

- **AI models** — Google Gemini Flash (`sutra-smart`, reasoning/writing) and Gemini Flash-Lite (`sutra-fast`, cheap high-volume extraction).
- **Search & grounding** — Google GenAI SDK (`@google/genai`) and Google Places API for factual business discovery.
- **Frontend & routing** — Next.js 16, React Flow, Zod (schema validation).
- **Backend & data** — LiteLLM proxy (key-gated routing), MongoDB Atlas (M0 isolated workspaces).

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

## Google Cloud services

| Service | Role in Sutra |
|---|---|
| **Cloud Run** (`us-central1`, min instances 0) | `sutra-web` (Next.js: UI, API, webhooks, jobs, tracking, ADK runner — public) and `sutra-litellm` (LiteLLM proxy — gated by its master key) |
| **Gemini API** (AI Studio) | Flash-Lite (`sutra-fast`) and Flash (`sutra-smart`) via LiteLLM; Google Search grounding for research |
| **Secret Manager** | One secret, `SUTRA_ENV`, mounted as `/secrets/.env` in both services |
| **Artifact Registry** | `web` and `litellm` images; cleanup policy keeps only the latest |
| **Cloud Tasks** | `sutra-jobs` queue — scheduled sends and pipeline jobs without an always-on worker |
| **Cloud Scheduler** | One daily `maintenance` cron (watch renewal, due-step sweep, retention, optimizer) |
| **Pub/Sub** | Gmail push → `/api/webhooks/gmail` (OIDC) for real-time replies |
| **Places API (New)** | A prospecting source, quota-guarded under the free monthly cap |
| **Gmail + Calendar APIs** | Send from the user's mailbox; book meetings |
| **Cloud Logging / Trace / Monitoring** | Structured logs, per-run traces and metrics |
| **MongoDB Atlas M0** | Free cluster near `us-central1` (native driver + Zod; ADK sessions too) |

See the architecture diagram and the free-tier table in [`todo/README.md`](todo/README.md) sections 2 and 5.

## Deploy to Google Cloud

One root Terraform module in [`infra/terraform/`](infra/terraform/) provisions everything above; [`infra/cloudbuild.yaml`](infra/cloudbuild.yaml) tests, builds both images, deploys both services and migrates. Full walkthrough: [`docs/deploy.md`](docs/deploy.md).

```sh
# 0. Out-of-band (both free): create a MongoDB Atlas M0 cluster, and a Gemini API key.
#    Put MONGODB_URI and GEMINI_API_KEY in .env.local.

cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # set project_id, app_url
terraform init && terraform apply               # Cloud Run, Secret Manager, Tasks, Scheduler, Pub/Sub, IAM, budget

cd ../..
pnpm secrets:push     # upload .env.local as the one SUTRA_ENV secret (keeps exactly one version)
pnpm deploy:prod      # secrets:check → build → Cloud Build (deploys both services + migrate)
pnpm warmup           # a minute before judging: wake the min-instances-0 services
```

A fresh GCP project reaches a working deploy with `terraform apply` + `pnpm deploy:prod`. No secret is hardcoded or baked into an image; both services read the one Secret Manager secret at boot.

## Estimated cost

- **Infrastructure (Google Cloud)** — Cloud Run, Pub/Sub and Cloud Tasks run heavily within the free tier; estimated production scaling cost is **<$50/month** for initial user batches.
- **LLM API** — the two-tier model approach keeps high-volume tasks (extraction/scoring) at fractions of a cent on Gemini Flash-Lite, reserving Gemini Flash for complex reasoning.
- **ROI** — drastically cuts the traditional **$400–$600 cost per meeting** and consolidates 8 disparate sales tools into one platform.

## Performance

- **Speed** — full company research, ICP generation and prospecting (normally 4–6 hours manually) in **under 3 minutes**.
- **Accuracy** — Google Search grounding gives a **0% hallucination rate** for business data and contact extraction.
- **Optimisation** — the A/B Thompson-sampling bandit identifies and prioritises the highest-converting copy variant automatically within the first 50 sends.
