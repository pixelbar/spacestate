# Remote state for the dev environment (`just tf-dev`, the Deploy dev workflow).
# Its own container rather than another key next to prod's: the Deploy dev
# identity gets Storage Blob Data Contributor on this container only, and prod's
# state holds prod's storage account keys.
# One-time: az storage container create --account-name pixelbartfstate \
#   --name spacestate-dev --auth-mode login

resource_group_name  = "pixel-bootstrap"
storage_account_name = "pixelbartfstate"
container_name       = "spacestate-dev"
key                  = "terraform.tfstate"
use_azuread_auth     = true
