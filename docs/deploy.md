# Deploy

Sutra deploys to Google Cloud as two Cloud Run services in `us-central1`, both on always-free tiers (see [`todo/README.md`](../todo/README.md) section 5). Infrastructure is one Terraform root module; the build/release pipeline is one Cloud Build config.

```
infra/
├─ terraform/        one root module: Cloud Run ×2, Secret Manager, Artifact Registry,
│                    Cloud Tasks, Cloud Scheduler, Pub/Sub, service accounts + IAM, budget
├─ cloudbuild.yaml   test → build both images → push → deploy both services → migrate
├─ docker/
│  ├─ web.Dockerfile      Next.js standalone (output: 'standalone')
│  └─ litellm.Dockerfile  official LiteLLM image + infra/litellm/config.yaml
└─ litellm/config.yaml    model aliases (sutra-fast / sutra-smart → Gemini)
```

## One-time, out of band (both free, neither has a Terraform-friendly free path)

1. **MongoDB Atlas M0** — create a free M0 cluster on GCP near `us-central1`. M0 has no private endpoints, so allowlist the egress (for the demo, `0.0.0.0/0` with a strong password is acceptable; tighten for anything real) and copy the SRV connection string.
2. **Gemini API key** — create it in a **separate GCP project with no billing account**, so it can never move off the free tier. Free-tier prompts may be used by Google to improve its products, so use demo data only.

Put both into `.env.local` (start from `.env.example`), with the rest of the config.

## Provision

```sh
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # set project_id; app_url can be a placeholder first
terraform init
terraform apply
```

`app_url` isn't known until Cloud Run exists. Apply once (the services come up on a placeholder `hello` image), read the `web_url` output, set `app_url` in `terraform.tfvars`, and apply again so Cloud Scheduler and the Pub/Sub push subscription target the real URL.

Terraform creates the empty `SUTRA_ENV` secret; it does **not** store any value. Upload the value yourself:

```sh
cd ../..
pnpm secrets:push      # validates .env.local, uploads it as SUTRA_ENV, destroys older versions
```

Terraform outputs you'll need:

| Output | Use |
|---|---|
| `web_url` | The public URL judges open; set as `APP_URL` / `NEXT_PUBLIC_APP_URL` and `app_url` |
| `gmail_push_topic` | `GMAIL_PUBSUB_TOPIC` for Gmail `users.watch` |
| `invoker_service_account` | `GMAIL_PUSH_SERVICE_ACCOUNT` (the webhook verifies this OIDC signer) |
| `web_service_account` | `JOBS_OIDC_SERVICE_ACCOUNT` for Cloud Tasks |
| `artifact_registry` | Where images are pushed |

After updating `.env.local` with the real URLs/SAs, re-run `pnpm secrets:push`.

## Release

```sh
pnpm deploy:prod
```

This runs `secrets:check` → `pnpm build` → `gcloud builds submit --config infra/cloudbuild.yaml`. Cloud Build then: installs and runs `lint`/`typecheck`/`test`/`eval`, builds the web (standalone) and litellm images, pushes them to Artifact Registry (cleanup keeps only the latest), deploys `sutra-litellm` then `sutra-web`, and runs idempotent `db:migrate` with the one secret materialised as `.env.local`. One command, inside the free Cloud Build quota.

CI (`.github/workflows/ci.yml`) and Cloud Build run the same gates, so a green PR builds the same images.

## Before judging

```sh
pnpm warmup            # min instances 0 → wake both services (/healthz and /health/liveliness)
```

Run it a minute before presenting. It exits non-zero if a service never answered.

## Config and secrets

All runtime config is the single Secret Manager secret `SUTRA_ENV` (a whole dotenv file), mounted at `/secrets/.env` and read by `@sutra/config`. Nothing is baked into an image. See [`docs/secrets.md`](secrets.md).

## Free-tier guardrails (enforced by test)

`@sutra/deploy`'s `auditInfra()` reads the committed infra and fails `pnpm test` if any of these drift: region not `us-central1`, a Cloud Run service without `min_instance_count = 0`, the litellm service not internal-only, more than one Secret Manager secret or Cloud Scheduler job, Artifact Registry not pruned to one image, a missing Cloud Tasks queue / Pub/Sub topic / budget guard, or a web image that isn't Next.js standalone. Keep the infra and `packages/deploy/src/constraints.ts` in step.
