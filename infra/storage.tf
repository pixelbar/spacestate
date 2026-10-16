# Cheapest redundancy tier (LRS) — acceptable for a hobby-space workload at
# this volume. Two tables for history (see src/storage): an append-only log
# and a singleton "current state" pointer. The config container holds the
# space.yaml blob; its *contents* are managed out-of-band (az storage blob
# upload), not by Terraform, so editing config never needs a plan/apply.
resource "azurerm_storage_account" "spacestate" {
  name                     = replace("${var.resource_group_name}st", "-", "")
  resource_group_name      = azurerm_resource_group.spacestate.name
  location                 = azurerm_resource_group.spacestate.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
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
