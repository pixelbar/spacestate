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

variable "custom_domains" {
  description = <<-EOT
    Hostnames to bind to the Container App, each with a managed certificate.
    Defaults to the production hostnames, so a plain apply keeps them bound.

    DNS lives outside Azure, so adding a domain is two phases:
      1. Create its records manually from the outputs (see outputs.tf): a
         CNAME to `default_fqdn` and a TXT at asuid.<host> holding
         `domain_verification_id`. Both outputs are the same for every domain.
      2. Once DNS has propagated, add the hostname here and apply. Listing it
         before then fails the certificate's validation.
  EOT
  type        = set(string)
  default     = ["spacestate.pixelbar.nl", "spaceapi.pixelbar.nl"]
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
