# Phase 2 of the custom domain rollout (see variables.tf: custom_domains).
#
# Azure won't issue a managed certificate until the hostname is already
# attached to an app in the environment, so each domain is bound in three
# ordered steps within a single apply:
#   1. attach the hostname with no certificate (binding Disabled)
#   2. issue the managed certificate (CNAME validation reuses the same record
#      the hostname needs, so there is no HTTP validation path to keep alive
#      on a scale-to-zero app)
#   3. bind the certificate to the hostname
resource "azurerm_container_app_custom_domain" "spacestate" {
  for_each         = var.custom_domains
  name             = each.key
  container_app_id = azurerm_container_app.spacestate.id

  # Step 3 sets these out of band; without ignore_changes the next plan would
  # try to revert the hostname to Disabled.
  lifecycle {
    ignore_changes = [
      certificate_binding_type,
      container_app_environment_certificate_id,
    ]
  }
}

resource "azurerm_container_app_environment_managed_certificate" "spacestate" {
  for_each                     = var.custom_domains
  name                         = replace(each.key, ".", "-")
  container_app_environment_id = azurerm_container_app_environment.spacestate.id
  subject_name                 = each.key
  domain_control_validation    = "CNAME"

  depends_on = [azurerm_container_app_custom_domain.spacestate]
}

# azurerm_container_app_custom_domain can't take a certificate that is created
# after it (see above), so the binding uses the az CLI, the same login the
# state backend already requires.
resource "terraform_data" "bind_certificate" {
  for_each = var.custom_domains

  triggers_replace = [
    azurerm_container_app_environment_managed_certificate.spacestate[each.key].id,
    each.key,
  ]

  provisioner "local-exec" {
    command = <<-EOT
      az containerapp hostname bind \
        --name ${azurerm_container_app.spacestate.name} \
        --resource-group ${azurerm_resource_group.spacestate.name} \
        --hostname ${each.key} \
        --environment ${azurerm_container_app_environment.spacestate.name} \
        --certificate ${azurerm_container_app_environment_managed_certificate.spacestate[each.key].id} \
        --output none
    EOT
  }
}
