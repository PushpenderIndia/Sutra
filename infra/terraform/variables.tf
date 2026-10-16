variable "project_id" {
  type        = string
  description = "Google Cloud project that hosts Sutra (Cloud Run, Secret Manager, Tasks, Pub/Sub)."
}

variable "region" {
  type        = string
  description = "Cloud Run region. Must be one of the three always-free regions."
  default     = "us-central1"

  validation {
    # Cloud Run's always-free monthly usage only applies in these three regions.
    condition     = contains(["us-central1", "us-east1", "us-west1"], var.region)
    error_message = "region must be a Cloud Run always-free region: us-central1, us-east1 or us-west1."
  }
}

variable "web_image" {
  type        = string
  description = "Fully-qualified image for sutra-web (Artifact Registry). Cloud Build sets this per deploy."
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "litellm_image" {
  type        = string
  description = "Fully-qualified image for sutra-litellm (Artifact Registry)."
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "app_url" {
  type        = string
  description = "Public base URL of sutra-web, used by the Pub/Sub push subscription and Cloud Scheduler."
}

variable "max_instances" {
  type        = number
  description = "Upper bound on Cloud Run instances (a backstop against a runaway bill)."
  default     = 2

  validation {
    condition     = var.max_instances >= 1 && var.max_instances <= 10
    error_message = "max_instances must be between 1 and 10 to stay inside the free tier."
  }
}

variable "budget_amount_usd" {
  type        = number
  description = "Monthly budget in USD. Alerts fire as spend approaches it; the free tier should keep spend at $0."
  default     = 1

  validation {
    condition     = var.budget_amount_usd >= 1 && var.budget_amount_usd <= 10
    error_message = "budget_amount_usd must be a small single- or double-digit backstop (1–10 USD)."
  }
}

variable "billing_account" {
  type        = string
  description = "Billing account id for the budget alert (e.g. 000000-AAAAAA-BBBBBB). Empty disables the budget."
  default     = ""
}

variable "budget_alert_emails" {
  type        = list(string)
  description = "Email channels notified when the budget threshold is crossed."
  default     = []
}

variable "places_daily_limit" {
  type        = number
  description = "Daily quota override for the Places API (New) Text Search SKU, kept under the free monthly cap."
  default     = 30
}
