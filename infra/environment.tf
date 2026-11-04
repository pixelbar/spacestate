# One root, two environments: prod (the default) and dev, each with its own
# state (backend.azurerm.hcl / backend.dev.azurerm.hcl) and its own resource
# group, so nothing in dev is shared with prod. `just tf-dev` picks dev's state
# and sets `environment = "dev"`; see README "Dev environment".
locals {
  is_prod = var.environment == "prod"

  # Prod keeps the names it was created with. Dev's resource group is suffixed,
  # and the storage account, Log Analytics workspace and Container Apps
  # environment are all named after it.
  resource_group_name = local.is_prod ? var.resource_group_name : "${var.resource_group_name}-${var.environment}"

  # Dev serves its *.azurecontainerapps.io hostname unless given domains.
  custom_domains = var.custom_domains != null ? var.custom_domains : (
    local.is_prod ? toset(["spacestate.pixelbar.nl", "spaceapi.pixelbar.nl"]) : toset([])
  )

  sentry_environment = coalesce(var.sentry_environment, local.is_prod ? "production" : var.environment)
}

# Ties a state to one environment. Prod's variables against dev's state (or the
# reverse, e.g. `-var environment=dev` after a prod `init`) would rename every
# resource, that is, destroy one environment to build the other in its place.
# Changing `environment` replaces this, and prevent_destroy turns that into a
# plan-time error before anything is touched.
#
# Tearing an environment down therefore starts with
# `terraform state rm terraform_data.environment`.
resource "terraform_data" "environment" {
  triggers_replace = [var.environment]

  lifecycle {
    prevent_destroy = true
  }
}
