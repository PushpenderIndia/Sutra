# Sutra

> **Sutra** (सूत्र, "thread") — one thread from first touch to closed deal.

Sutra is an AI outbound-sales workspace. Paste your website and Sutra learns your business, finds your ideal customers across several sources, writes and A/B-tests multi-step outreach, sends it from your own Gmail, and books meetings — with a person approving the business profile and the campaign before anything is sent. It runs on Google Cloud free tiers with Gemini, Google ADK agents and MongoDB Atlas.

## Quick start

Requires Node 22 and pnpm 10.

```sh
pnpm i && pnpm dev   # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run the app in dev mode |
| `pnpm build` | Production build |
| `pnpm lint` / `pnpm format` | Biome check / fix |
| `pnpm typecheck` | TypeScript across every workspace |
| `pnpm test` | Vitest across every workspace |

## Layout

```
apps/web            Next.js app (UI, API, webhooks, jobs, agents runtime)
packages/config     env + secrets (the only reader of process.env)
packages/domain     Zod schemas, enums, pure helpers
packages/db         MongoDB client and repositories
packages/agents     ADK agents, tools, prompts, pipeline
packages/sources    lead sources
packages/mail       Gmail send, threading, tracking
packages/compliance policy engine + country rule packs
```

Internal packages export TypeScript source directly (no build step); the app compiles them via `transpilePackages`. The build plan lives in [`todo/`](todo/README.md).
