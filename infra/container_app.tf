resource "azurerm_container_app" "spacestate" {
  name                         = "spacestate"
  resource_group_name          = azurerm_resource_group.spacestate.name
  container_app_environment_id = azurerm_container_app_environment.spacestate.id
  revision_mode                = "Single"

  # The Release workflow owns the running image (`az containerapp update`).
  # `var.container_image` only seeds the first create; without this a later
  # `terraform apply` would roll prod back to whatever tag is in the tfvars.
  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  identity {
    type = "SystemAssigned"
  }

  # Public GHCR image: Container Apps pulls it directly, no registry block
  # or pull secret needed (see the plan: GHCR over ACR specifically to avoid
  # ACR Basic's flat monthly cost).
  template {
    min_replicas = 0 # scale-to-zero
    max_replicas = 1

    container {
      name   = "spacestate"
      image  = var.container_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "SPACEAPI_CONFIG_SOURCE"
        value = "blob://${azurerm_storage_account.spacestate.name}/${azurerm_storage_container.config.name}/spaceapi.json"
      }

      env {
        name  = "API_KEYS_CONFIG_SOURCE"
        value = "blob://${azurerm_storage_account.spacestate.name}/${azurerm_storage_container.config.name}/api-keys.yaml"
      }

      env {
        name  = "LEGACY_CONFIG_SOURCE"
        value = "blob://${azurerm_storage_account.spacestate.name}/${azurerm_storage_container.config.name}/legacy.yaml"
      }

      # Optional: until notifications.yaml is uploaded the app runs without
      # announcing changes, and picks it up within minutes once it is.
      env {
        name  = "NOTIFICATIONS_CONFIG_SOURCE"
        value = "blob://${azurerm_storage_account.spacestate.name}/${azurerm_storage_container.config.name}/notifications.yaml"
      }

      env {
        name  = "AZURE_STORAGE_ACCOUNT_NAME"
        value = azurerm_storage_account.spacestate.name
      }

      env {
        name  = "SENTRY_ENVIRONMENT"
        value = var.sentry_environment
      }

      # var.sentry_enabled (default true) decides this, and its validation in
      # variables.tf guarantees a DSN when it is on — so a forgotten
      # -var="sentry_dsn=..." fails the apply instead of deploying an app that
      # silently reports nothing.
      dynamic "env" {
        for_each = var.sentry_enabled ? [1] : []
        content {
          name        = "SENTRY_DSN"
          secret_name = "sentry-dsn"
        }
      }

      # Process-only (see src/plugins/health.ts): a storage hiccup must not
      # flap a replica that's waking up from scale-to-zero.
      liveness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/healthz"
      }

      readiness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/healthz"
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  dynamic "secret" {
    for_each = var.sentry_enabled ? [1] : []
    content {
      name  = "sentry-dsn"
      value = var.sentry_dsn
    }
  }
}

# Container-level scope: azurerm_storage_container doesn't expose an ARM
# resource ID directly, so it's constructed from the storage account ID —
# the standard pattern for scoping RBAC to a single blob container.
resource "azurerm_role_assignment" "config_blob_reader" {
  scope                = "${azurerm_storage_account.spacestate.id}/blobServices/default/containers/${azurerm_storage_container.config.name}"
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azurerm_container_app.spacestate.identity[0].principal_id
}

resource "azurerm_role_assignment" "table_data_contributor" {
  scope                = azurerm_storage_account.spacestate.id
  role_definition_name = "Storage Table Data Contributor"
  principal_id         = azurerm_container_app.spacestate.identity[0].principal_id
}
