# Cheapest redundancy tier (LRS) — acceptable for a hobby-space workload at
# this volume. Two tables for history (see src/storage): an append-only log
# and a singleton "current state" pointer. The config container holds the
# config blobs; its *contents* are managed out-of-band (az storage blob
# upload), not by Terraform, so editing config never needs a plan/apply.
resource "azurerm_storage_account" "spacestate" {
  name                     = replace("${local.resource_group_name}st", "-", "")
  resource_group_name      = azurerm_resource_group.spacestate.name
  location                 = azurerm_resource_group.spacestate.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"

  # Azure AD only. The config blobs hold credentials (API keys, legacy device
  # tokens, notification tokens), and an account key would bypass RBAC:
  # Contributor on the resource group, which the prod CI identity has, can list
  # the keys and read every blob. With keys off, reading a blob takes a
  # Storage Blob Data role, which only the app (Reader, config container only)
  # and the operators who run `just push` hold. The app, `just` and the README's
  # `az` commands all authenticate with Azure AD already.
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true
  allow_nested_items_to_be_public = false
}

resource "azurerm_storage_table" "state_history" {
  name               = "StateHistory"
  storage_account_id = azurerm_storage_account.spacestate.id
}

resource "azurerm_storage_table" "current_state" {
  name               = "CurrentState"
  storage_account_id = azurerm_storage_account.spacestate.id
}

resource "azurerm_storage_container" "config" {
  name                  = "config"
  storage_account_id    = azurerm_storage_account.spacestate.id
  container_access_type = "private"
}

# Registered webhooks (webhooks.yaml). Unlike the config container, the app
# itself writes here (POST /api/v1/webhooks), so it gets its own container and
# the only write grant on the account's blobs — a compromised app can then
# change who is notified, but not mint API keys or rewrite the SpaceAPI document.
resource "azurerm_storage_container" "webhooks" {
  name                  = "webhooks"
  storage_account_id    = azurerm_storage_account.spacestate.id
  container_access_type = "private"
}
