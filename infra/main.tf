resource "azurerm_resource_group" "spacestate" {
  name     = local.resource_group_name
  location = var.location
}

resource "azurerm_log_analytics_workspace" "spacestate" {
  name                = "${local.resource_group_name}-logs"
  resource_group_name = azurerm_resource_group.spacestate.name
  location            = azurerm_resource_group.spacestate.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_container_app_environment" "spacestate" {
  name                       = "${local.resource_group_name}-env"
  resource_group_name        = azurerm_resource_group.spacestate.name
  location                   = azurerm_resource_group.spacestate.location
  logs_destination           = "log-analytics"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.spacestate.id
}
