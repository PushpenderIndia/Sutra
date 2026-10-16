# Config and secrets

All runtime config lives in **one** Secret Manager secret, `SUTRA_ENV`, whose value is a whole dotenv file. Code reads config only through `@sutra/config`; Biome's `noProcessEnv` rule fails the lint anywhere else.

```
SUTRA_ENV (Secret Manager) ──Cloud Run mounts──▶ /secrets/.env ──▶ @sutra/config (Zod) ──▶ app code
        ▲                                                              ▲
        └── pnpm secrets:push ── .env.local ◀── pnpm secrets:pull ─────┘ (local dev)
```

## Where values come from

`@sutra/config` merges, lowest to highest precedence:

1. `.env.local` at the repo root (local dev; never committed)
2. `process.env`
3. The mounted secret file: `SUTRA_ENV_FILE`, default `/secrets/.env`

The result is validated against `packages/config/src/schema.ts` once, at boot (`apps/web/instrumentation.ts`). A missing or invalid key stops the server with a list of **every** bad key.

| Import | Use |
|---|---|
| `import { env, encrypt, decrypt } from '@sutra/config'` | Server code only. Marked `server-only`, so importing it from a client component fails the build. |
| `import { clientEnv } from '@sutra/config/client'` | Browser-safe `NEXT_PUBLIC_*` values. |

## Scripts

| Command | Does |
|---|---|
| `pnpm secrets:pull` | Latest `SUTRA_ENV` → `.env.local` |
| `pnpm secrets:push` | Validates `.env.local`, uploads it as a new `SUTRA_ENV` version (creating the secret if needed), then destroys every older version so exactly one stays active |
| `pnpm secrets:check` | Validates the current env; exits non-zero with every problem listed |
| `pnpm secrets:example` | Regenerates `.env.example` from the schema |

`pull`/`push` use your `gcloud` login and `GCP_PROJECT_ID` (falling back to the gcloud default project). Without GCP access, `cp .env.example .env.local`: the placeholders validate, so the app boots.

## Adding a key

1. Add it to `serverSchema` (or `clientSchema` for `NEXT_PUBLIC_*`) in `packages/config/src/schema.ts`, with a description and example via `doc()`.
2. `pnpm secrets:example` and commit the regenerated `.env.example` (a test fails if it drifts).
3. Add the real value to `.env.local`, then `pnpm secrets:push`.

That's it: the next deploy mounts the new version.

## Tenant secrets

Per-workspace credentials (Gmail refresh tokens, optional Apollo/Hunter keys) are stored in Mongo, encrypted with `encrypt()`: AES-256-GCM, a random IV per value, output `v1:<base64url(iv | tag | ciphertext)>`. Tampered values throw on `decrypt()`.

`ENCRYPTION_KEY` is a keyring: `v1:<openssl rand -base64 32>`. To rotate, prepend a new key (`v2:<new>,v1:<old>`): new values use `v2`, old ones still decrypt.
