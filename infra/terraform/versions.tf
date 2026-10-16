# Sutra infrastructure — one root module. Everything here stays inside Google Cloud's
# always-free tiers (see todo/README.md section 5): us-central1 only, Cloud Run min instances 0,
# one Secret Manager secret, a single Cloud Scheduler job, Artifact Registry cleanup to one image,
# and a $1 budget alert as a backstop.
terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0.0, < 7.0.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = ">= 6.0.0, < 7.0.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
