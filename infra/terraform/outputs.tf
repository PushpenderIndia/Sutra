output "web_url" {
  description = "Public URL of sutra-web — the one URL judges open."
  value       = google_cloud_run_v2_service.web.uri
}

output "litellm_url" {
  description = "Internal URL of the LiteLLM proxy (reachable only from sutra-web)."
  value       = google_cloud_run_v2_service.litellm.uri
}

output "artifact_registry" {
  description = "Docker repository that holds the web and litellm images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.sutra.repository_id}"
}

output "gmail_push_topic" {
  description = "Pub/Sub topic to pass to Gmail users.watch (GMAIL_PUBSUB_TOPIC)."
  value       = google_pubsub_topic.gmail_push.id
}

output "web_service_account" {
  description = "Runtime service account for sutra-web (set as JOBS_OIDC_SERVICE_ACCOUNT / GMAIL_PUSH_SERVICE_ACCOUNT inputs)."
  value       = google_service_account.web.email
}

output "invoker_service_account" {
  description = "Service account Cloud Scheduler and the Pub/Sub push subscription sign OIDC tokens with."
  value       = google_service_account.invoker.email
}
