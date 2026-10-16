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
  features {}
}
