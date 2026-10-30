terraform {
  required_version = ">= 1.9"

  # Settings live in backend.azurerm.hcl: terraform init -backend-config=backend.azurerm.hcl
  backend "azurerm" {}

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.9"
    }
  }
}

provider "azurerm" {
  # The Deploy dev identity can reach only dev's resource group, so it cannot
  # register resource providers on the subscription. Prod already uses every
  # one this stack needs (Microsoft.App, .Storage, .OperationalInsights).
  resource_provider_registrations = "none"

  features {
    log_analytics_workspace {
      # Destroy dev deletes dev's workspace and the next Deploy dev recreates it
      # under the same name, so dev skips the 14-day soft delete. Prod keeps it.
      permanently_delete_on_destroy = !local.is_prod
    }
  }
}
