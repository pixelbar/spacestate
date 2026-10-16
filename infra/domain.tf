# Phase 2 of the custom domain rollout (see variables.tf: bind_custom_domain).
# CNAME validation is used for the managed certificate specifically because
# it reuses the same CNAME record already required for the domain binding
# itself — no separate HTTP-serving validation path to build or keep alive
# on a scale-to-zero app.
resource "azurerm_container_app_environment_managed_certificate" "spacestate" {
  count                        = var.bind_custom_domain ? 1 : 0
  name                         = replace(var.custom_domain, ".", "-")
  container_app_environment_id = azurerm_container_app_environment.spacestate.id
  subject_name                 = var.custom_domain
  domain_control_validation    = "CNAME"
}

resource "azurerm_container_app_custom_domain" "spacestate" {
  count                                    = var.bind_custom_domain ? 1 : 0
  name                                     = var.custom_domain
  container_app_id                         = azurerm_container_app.spacestate.id
  container_app_environment_certificate_id = azurerm_container_app_environment_managed_certificate.spacestate[0].id
  certificate_binding_type                 = "SniEnabled"

  # The certificate_id reference above already implies ordering, but cert
  # issuance has been known to race the domain binding in practice — this
  # depends_on is a defensive, documented workaround for that.
  depends_on = [azurerm_container_app_environment_managed_certificate.spacestate]
}
