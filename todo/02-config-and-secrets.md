# PR 02 — Config and secrets: one place

**Branch:** `feat/02-config-and-secrets` · **Depends on:** 01 · **Size:** S

## Why
Secrets must live in exactly one place, and code must read config from exactly one module. That removes a whole class of bugs: a typo in an env var name, a secret leaked to the client bundle, or a missing key discovered only at runtime.

## Model

```
Secret Manager: ONE secret "SUTRA_ENV" (dotenv text) ──(Cloud Run mounts as file /secrets/.env)──▶ @sutra/config (Zod) ──▶ app code
        ▲                                                                   ▲
        │ pnpm secrets:push                                                 │ local dev: .env.local (pulled, never committed)
        └──────────────────────── pnpm secrets:pull ───────────────────────┘
```

- **Source of truth:** **one** Secret Manager secret, `SUTRA_ENV`, whose value is the whole dotenv file. One secret version stays inside the free tier, and there's literally one place to look.
- **Runtime:** Cloud Run mounts `SUTRA_ENV` as a file (`/secrets/.env`). At boot, `@sutra/config` parses that file (if present) merged over `process.env`. There's no Secret Manager API call at request time.
- **Local:** `pnpm secrets:pull` runs `gcloud secrets versions access latest --secret=SUTRA_ENV > .env.local`. New devs without GCP access copy `.env.example`.
- **Both services** (web and the LiteLLM proxy) mount the same secret. LiteLLM reads its keys from the same env names.
- **Code:** only `@sutra/config` reads `process.env`. Enforced by Biome.
- **Tenant secrets** (per-workspace Gmail refresh tokens, optional Apollo/Hunter API keys) are **not** env vars. They're stored in Mongo, encrypted with **AES-256-GCM** (Node `crypto`, random IV per value, key version prefix for rotation) using `ENCRYPTION_KEY` from `SUTRA_ENV`. There's no KMS, so zero cost. The helper lives in this package.

## Design

```ts
// packages/config/src/schema.ts
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url(),
  // Data
  MONGODB_URI: z.string().startsWith('mongodb'),
  MONGODB_DB: z.string().default('sutra'),
  // Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  // Google Cloud
  GCP_PROJECT_ID: z.string(),
  GCP_REGION: z.string().default('us-central1'),   // Cloud Run free tier region
  ENCRYPTION_KEY: z.string(),                      // 32 bytes base64, tenant credential encryption
  GOOGLE_MAPS_API_KEY: z.string(),
  PLACES_MONTHLY_LIMIT: z.coerce.number().default(900),   // stay under the free cap
  // LLM
  LITELLM_BASE_URL: z.url(),
  LITELLM_API_KEY: z.string(),
  GEMINI_API_KEY: z.string(),                      // AI Studio key from a project WITHOUT billing
  // Email
  GMAIL_PUBSUB_TOPIC: z.string().optional(),
  TRACKING_SECRET: z.string().min(32),             // signs open/click/unsubscribe tokens
  // Jobs
  JOBS_DRIVER: z.enum(['inline', 'cloud-tasks']).default('inline'),
  CLOUD_TASKS_QUEUE: z.string().optional(),
  JOBS_OIDC_SERVICE_ACCOUNT: z.string().optional(),
  // Feature flags
  FEATURE_PAID_SOURCES: bool.default(false),       // allow workspaces to enable Apollo/Hunter
  FAKE_MAIL: bool.default(false),                  // demo mode: simulate sends, opens, clicks, replies
});

export const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
});
```

```ts
// packages/config/src/index.ts
import 'server-only';
export const env = parse(serverSchema, process.env);   // throws one readable error listing ALL missing keys
export type Env = typeof env;
export { encrypt, decrypt } from './crypto';           // AES-256-GCM with ENCRYPTION_KEY
```

- `packages/config/src/client.ts` exports only `clientSchema` values, so it's safe to import in client components.
- `.env.example` is **generated** from the schema (`pnpm secrets:example`), so it never drifts.
- LiteLLM's `config.yaml` (PR 06) references the same env names: `os.environ/GEMINI_API_KEY`.

## Scripts (`packages/config/scripts/`)
| Script | Does |
|---|---|
| `secrets:example` | Writes `.env.example` from the schema keys and descriptions |
| `secrets:pull` | `SUTRA_ENV` → `.env.local` |
| `secrets:push` | `.env.local` → new version of `SUTRA_ENV` (creates it if missing), then **destroys older versions** so only one active version exists |
| `secrets:check` | Validates the current env against the schema; used in CI and Docker entrypoints |

All scripts iterate `Object.keys(serverSchema.shape)`, so adding a key in one place updates everything.

## Tasks
- [x] Zod schemas + `parse()` with aggregated errors
- [x] `encrypt/decrypt` (AES-256-GCM, versioned key prefix)
- [x] Load `/secrets/.env` when mounted, merged over `process.env`
- [x] Four scripts above
- [x] Biome `noProcessEnv` override confirmed
- [x] `docs/secrets.md`: how to add a secret (edit schema → `secrets:push` → done)

## Acceptance criteria
- With a missing `MONGODB_URI`, the app fails at boot with a message listing every missing or invalid key
- Importing `@sutra/config` from a client component fails the build (`server-only`)
- `decrypt(encrypt(x)) === x`, and tampered ciphertext throws (tested)
- Only one active version of `SUTRA_ENV` exists after `secrets:push`
- `.env.example` is produced only by the script

## Out of scope
Secret rotation automation.
