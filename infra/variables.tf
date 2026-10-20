variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "westeurope"
}

variable "resource_group_name" {
  description = "Name of the resource group to create. Kept short: it also seeds the storage account name, which has a 24-character limit."
  type        = string
  default     = "pixelbar-spacestate"
}

variable "custom_domain" {
  description = "Hostname to bind to the Container App, e.g. spacestate.pixelbar.nl. DNS lives outside Azure, so the matching records must be created manually — see outputs.tf."
  type        = string
}

variable "container_image" {
  description = "Public GHCR image reference, e.g. ghcr.io/pixelbar/spacestate:v0.1.0. Public image: no registry credentials needed."
  type        = string
}

variable "sentry_enabled" {
  description = <<-EOT
    Whether this deployment reports to Sentry. True (the default) requires
    `sentry_dsn` to be set, so an apply that forgets it fails instead of
    quietly deploying with error reporting off.

    Set it to false to deploy without Sentry on purpose. `sentry_dsn` is then
    ignored (no secret, no `SENTRY_DSN` on the container), whether or not it
    still sits in a tfvars file.
  EOT
  type        = bool
  default     = true
}

variable "sentry_dsn" {
  description = <<-EOT
    Sentry DSN, e.g. https://<key>@<org>.ingest.de.sentry.io/<project>. Required
    unless `sentry_enabled` is false. Pass it per apply with
    -var="sentry_dsn=..." or keep it in a gitignored infra/*.auto.tfvars —
    there is no Key Vault in this stack, so Terraform is the only source.
  EOT
  type        = string
  sensitive   = true
  default     = ""

  # Cross-variable validation needs Terraform >= 1.9 (see versions.tf).
  validation {
    condition     = !var.sentry_enabled || trimspace(var.sentry_dsn) != ""
    error_message = "sentry_dsn must be set, otherwise the deployed app reports nothing. Pass -var=\"sentry_dsn=...\" (or put it in a gitignored infra/*.auto.tfvars), or pass -var=\"sentry_enabled=false\" to deploy without error reporting on purpose."
  }
}

variable "sentry_environment" {
  description = "Sentry environment tag."
  type        = string
  default     = "production"
}

variable "bind_custom_domain" {
  description = <<-EOT
    Two-phase rollout switch for the custom domain, required because DNS is external:
      1. Apply with this set to false. Read the `domain_verification_id` and
         `default_fqdn` outputs and create the TXT/CNAME records manually.
      2. Once DNS has propagated, set this to true and apply again to create
         the managed certificate and bind the domain.
  EOT
  type        = bool
  default     = false
}
