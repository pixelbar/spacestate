# Remote state, shared with the other Pixelbar stacks' bootstrap storage account.
# Needs `az login` and Storage Blob Data Contributor on the container.
# One-time: az storage container create --account-name pixelbartfstate \
#   --name spacestate --auth-mode login

resource_group_name  = "pixel-bootstrap"
storage_account_name = "pixelbartfstate"
container_name       = "spacestate"
key                  = "terraform.tfstate"
use_azuread_auth     = true
