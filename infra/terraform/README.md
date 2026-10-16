# infra/terraform

One root module for all of Sutra's Google Cloud infrastructure, kept inside the always-free tiers
(see [`todo/README.md`](../../todo/README.md) section 5). Full walkthrough: [`docs/deploy.md`](../../docs/deploy.md).

| File | Contents |
|---|---|
| `versions.tf` | Terraform + provider version constraints, provider config |
| `variables.tf` | Inputs (project, region, images, budget) with free-tier validations |
| `main.tf` | APIs, Artifact Registry, Secret Manager, service accounts + IAM, both Cloud Run services, Cloud Tasks, Cloud Scheduler, Pub/Sub, billing budget |
| `outputs.tf` | `web_url`, `litellm_url`, `artifact_registry`, `gmail_push_topic`, service accounts |
| `terraform.tfvars.example` | Copy to `terraform.tfvars` and fill in (gitignored) |

```sh
cp terraform.tfvars.example terraform.tfvars   # set project_id, app_url
terraform init
terraform apply
```

Terraform creates the **empty** `SUTRA_ENV` secret; upload its value with `pnpm secrets:push` (never put secrets in `.tfvars`). MongoDB Atlas M0 and the Gemini API key are provisioned out of band (both free) — see `docs/deploy.md`.

The free-tier invariants in this module are checked by a test (`@sutra/deploy` `auditInfra`), so an edit that would leave the free tier fails `pnpm test`.
