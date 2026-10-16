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

variable "sentry_dsn" {
  description = "Sentry DSN. Empty string disables Sentry entirely — the app no-ops without a DSN."
  type        = string
  sensitive   = true
  default     = ""
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
