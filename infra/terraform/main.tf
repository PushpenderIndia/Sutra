locals {
  # Cloud Run mounts the one secret here; @sutra/config reads /secrets/.env (see packages/config/src/load.ts).
  secret_mount_dir  = "/secrets"
  secret_mount_file = ".env"
}

# ---------------------------------------------------------------------------
# APIs — enable everything the deploy touches. Enabling an API is free.
# ---------------------------------------------------------------------------
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudtasks.googleapis.com",
    "cloudscheduler.googleapis.com",
    "pubsub.googleapis.com",
    "cloudbuild.googleapis.com",
    "places.googleapis.com",
    "gmail.googleapis.com",
    "calendar-json.googleapis.com",
    "iam.googleapis.com",
    "cloudbilling.googleapis.com",
    "billingbudgets.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Artifact Registry — images for web and litellm. Cleanup keeps only the
# latest version so storage stays under the 0.5 GB free tier.
# ---------------------------------------------------------------------------
resource "google_artifact_registry_repository" "sutra" {
  repository_id = "sutra"
  location      = var.region
  format        = "DOCKER"
  description   = "Sutra container images (web + litellm)."
  depends_on    = [google_project_service.apis]

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-latest-only"
    action = "KEEP"
    most_recent_versions {
      keep_count = 1
    }
  }

  cleanup_policies {
    id     = "delete-everything-else"
    action = "DELETE"
    condition {
      tag_state = "ANY"
      # Anything older than the single kept version is removed hourly.
      older_than = "3600s"
    }
  }
}

# ---------------------------------------------------------------------------
# Secret Manager — the one secret, a whole dotenv file. Terraform creates the
# container; `pnpm secrets:push` uploads the value (keeping exactly one version).
# ---------------------------------------------------------------------------
resource "google_secret_manager_secret" "sutra_env" {
  secret_id  = "SUTRA_ENV"
  depends_on = [google_project_service.apis]

  replication {
    auto {}
  }
}

# ---------------------------------------------------------------------------
# Service accounts — least privilege (PR 18). One identity per trust boundary.
# ---------------------------------------------------------------------------
resource "google_service_account" "web" {
  account_id   = "sutra-web"
  display_name = "Sutra web (Cloud Run runtime)"
}

resource "google_service_account" "litellm" {
  account_id   = "sutra-litellm"
  display_name = "Sutra LiteLLM proxy (Cloud Run runtime)"
}

resource "google_service_account" "invoker" {
  account_id   = "sutra-invoker"
  display_name = "Sutra scheduler / tasks / pubsub invoker"
}

# Both runtimes read the one secret; nothing else may.
resource "google_secret_manager_secret_iam_member" "web_reads_secret" {
  secret_id = google_secret_manager_secret.sutra_env.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.web.email}"
}

resource "google_secret_manager_secret_iam_member" "litellm_reads_secret" {
  secret_id = google_secret_manager_secret.sutra_env.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.litellm.email}"
}

# Cloud Build runs as the Compute Engine default SA; its migrate step reads SUTRA_ENV.
data "google_project" "this" {}

resource "google_secret_manager_secret_iam_member" "build_reads_secret" {
  secret_id = google_secret_manager_secret.sutra_env.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.this.number}-compute@developer.gserviceaccount.com"
}

# The web runtime enqueues Cloud Tasks and acts as the OIDC token creator for the tasks it signs.
resource "google_project_iam_member" "web_enqueues_tasks" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.web.email}"
}

resource "google_service_account_iam_member" "web_signs_task_tokens" {
  service_account_id = google_service_account.invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.web.email}"
}

# Observability: the web runtime writes logs, traces and metrics.
resource "google_project_iam_member" "web_telemetry" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/cloudtrace.agent",
    "roles/monitoring.metricWriter",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.web.email}"
}

# ---------------------------------------------------------------------------
# Cloud Run — sutra-web (public) and sutra-litellm (public URL, master-key gated).
# Both: min instances 0 (scale to zero), modest ceilings, the secret mounted as a file.
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "litellm" {
  name     = "sutra-litellm"
  location = var.region
  # Public URL, but every request needs the LiteLLM master key (LITELLM_API_KEY): sutra-web calls
  # it over the internet with that key, since it has no VPC egress for an internal-only ingress.
  ingress = "INGRESS_TRAFFIC_ALL"

  deletion_protection = false
  depends_on          = [google_secret_manager_secret_iam_member.litellm_reads_secret]

  template {
    service_account = google_service_account.litellm.email

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      image = var.litellm_image
      ports {
        container_port = 4000
      }
      resources {
        limits = {
          cpu = "1"
          # LiteLLM peaks just over 512Mi at startup (OOM-killed there), so give it 1Gi.
          memory = "1Gi"
        }
        cpu_idle = true
      }
      volume_mounts {
        name       = "sutra-env"
        mount_path = local.secret_mount_dir
      }
    }

    volumes {
      name = "sutra-env"
      secret {
        secret = google_secret_manager_secret.sutra_env.secret_id
        items {
          version = "latest"
          path    = local.secret_mount_file
        }
      }
    }
  }

  # Cloud Build (`gcloud run deploy`) owns the image after the first apply; don't revert it.
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

resource "google_cloud_run_v2_service" "web" {
  name     = "sutra-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  deletion_protection = false
  depends_on          = [google_secret_manager_secret_iam_member.web_reads_secret]

  template {
    service_account = google_service_account.web.email

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      image = var.web_image
      ports {
        container_port = 3000
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle = true
      }
      # The LiteLLM base URL is the internal service; the rest of config comes from the mounted secret.
      env {
        name  = "LITELLM_BASE_URL"
        value = google_cloud_run_v2_service.litellm.uri
      }
      volume_mounts {
        name       = "sutra-env"
        mount_path = local.secret_mount_dir
      }
    }

    volumes {
      name = "sutra-env"
      secret {
        secret = google_secret_manager_secret.sutra_env.secret_id
        items {
          version = "latest"
          path    = local.secret_mount_file
        }
      }
    }
  }

  # Cloud Build (`gcloud run deploy`) owns the image after the first apply; don't revert it.
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

# sutra-web is public (judges open the URL); sutra-litellm is public but gated by its master key.
resource "google_cloud_run_v2_service_iam_member" "web_public" {
  name     = google_cloud_run_v2_service.web.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "litellm_keyed" {
  name     = google_cloud_run_v2_service.litellm.name
  location = var.region
  role     = "roles/run.invoker"
  # Cloud Run IAM lets anyone through; LiteLLM's master_key rejects requests without LITELLM_API_KEY.
  member = "allUsers"
}

# The invoker SA may call the web service for scheduled jobs and Gmail push.
resource "google_cloud_run_v2_service_iam_member" "invoker_calls_web" {
  name     = google_cloud_run_v2_service.web.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.invoker.email}"
}

# ---------------------------------------------------------------------------
# Cloud Tasks — the job queue. Rate limits and retry policy keep retries sane
# and well inside the free monthly quota.
# ---------------------------------------------------------------------------
resource "google_cloud_tasks_queue" "jobs" {
  name       = "sutra-jobs"
  location   = var.region
  depends_on = [google_project_service.apis]

  rate_limits {
    max_dispatches_per_second = 5
    max_concurrent_dispatches = 10
  }

  retry_config {
    max_attempts       = 5
    min_backoff        = "10s"
    max_backoff        = "300s"
    max_doublings      = 4
    max_retry_duration = "3600s"
  }
}

# ---------------------------------------------------------------------------
# Cloud Scheduler — the ONE cron job (keeps within the 3-job free tier):
# maintenance, daily. Posts to /api/jobs/maintenance with an OIDC token.
# ---------------------------------------------------------------------------
resource "google_cloud_scheduler_job" "maintenance" {
  name       = "maintenance"
  region     = var.region
  schedule   = "0 2 * * *"
  time_zone  = "Etc/UTC"
  depends_on = [google_project_service.apis]

  http_target {
    http_method = "POST"
    uri         = "${var.app_url}/api/jobs/maintenance"
    body        = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }
    oidc_token {
      service_account_email = google_service_account.invoker.email
      audience              = var.app_url
    }
  }

  retry_config {
    retry_count = 3
  }
}

# ---------------------------------------------------------------------------
# Pub/Sub — Gmail push notifications. Gmail's watch publishes to this topic; a
# push subscription delivers to /api/webhooks/gmail with an OIDC token.
# ---------------------------------------------------------------------------
resource "google_pubsub_topic" "gmail_push" {
  name       = "gmail-push"
  depends_on = [google_project_service.apis]
}

# Gmail's system service account must be allowed to publish to the topic.
resource "google_pubsub_topic_iam_member" "gmail_publishes" {
  topic  = google_pubsub_topic.gmail_push.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:gmail-api-push@system.gserviceaccount.com"
}

resource "google_pubsub_subscription" "gmail_push" {
  name  = "gmail-push-web"
  topic = google_pubsub_topic.gmail_push.id

  ack_deadline_seconds       = 30
  message_retention_duration = "86400s"

  push_config {
    push_endpoint = "${var.app_url}/api/webhooks/gmail"
    oidc_token {
      service_account_email = google_service_account.invoker.email
      audience              = var.app_url
    }
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}

# ---------------------------------------------------------------------------
# Billing budget — a $1 alert as a backstop. The free tiers should keep real
# spend at $0; this fires long before anything costs money.
# ---------------------------------------------------------------------------
resource "google_billing_budget" "guard" {
  count = var.billing_account == "" ? 0 : 1

  billing_account = var.billing_account
  display_name    = "Sutra free-tier guard"

  budget_filter {
    projects = ["projects/${var.project_id}"]
  }

  amount {
    # No currency_code: the budget must use the billing account's own currency (e.g. INR), so
    # on a non-USD account this is that many units of the local currency — an even earlier alert.
    specified_amount {
      units = tostring(var.budget_amount_usd)
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }

  dynamic "all_updates_rule" {
    for_each = length(google_monitoring_notification_channel.budget) > 0 ? [1] : []
    content {
      monitoring_notification_channels = google_monitoring_notification_channel.budget[*].id
      disable_default_iam_recipients   = false
    }
  }
}

resource "google_monitoring_notification_channel" "budget" {
  count        = var.billing_account == "" ? 0 : length(var.budget_alert_emails)
  display_name = "Sutra budget alert ${count.index}"
  type         = "email"
  labels = {
    email_address = var.budget_alert_emails[count.index]
  }
  depends_on = [google_project_service.apis]
}
