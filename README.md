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
| `pnpm agent:try <agent> "<input>"` | Run one agent through the LiteLLM proxy in a Mongo session (`--session key` to resume) |
| `pnpm secrets:pull` / `push` / `check` / `example` | Manage the `SUTRA_ENV` secret ([docs/secrets.md](docs/secrets.md)) |

## Auth and workspaces

Sign-in is Google only (Better Auth). A workspace is a Better Auth organization with roles `owner`, `admin` and `member`; onboarding asks one question, the company website, and creates the workspace. Every Server Action is defined with `action()` / `userAction()` and every route handler with `route()` from `apps/web/lib/action.ts` (session → active workspace → role → Zod input); a test fails on any that isn't. Webhooks and jobs verify signatures with `apps/web/lib/verify.ts` instead. Google refresh tokens are kept only in `credentials`, encrypted.

For local sign-in, create an OAuth client (Web) in Google Cloud with redirect URI `http://localhost:3000/api/auth/callback/google` and put its ID and secret in `.env.local`.

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
