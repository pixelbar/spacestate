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
#
# Steps 1 and 3 go through hostname.sh rather than azurerm_container_app_custom_domain:
# every hostname write rewrites the app's whole domain list, the provider only
# locks its creates against each other, and the bind has to be done with the
# az CLI anyway. One script holding one lock is what keeps an apply that
# touches several domains from losing a write.
locals {
  hostname_script = {
    script         = "${path.module}/hostname.sh"
    app            = azurerm_container_app.spacestate.name
    resource_group = azurerm_resource_group.spacestate.name
  }
}

resource "terraform_data" "hostname" {
  for_each = local.custom_domains

  triggers_replace = [each.key]

  # Destroy provisioners can only read self.
  input = local.hostname_script

  provisioner "local-exec" {
    command = "${self.input.script} add ${self.input.app} ${self.input.resource_group} ${each.key}"
  }

  # Normally a no-op: bind_certificate's destroy has already taken the
  # hostname off. Covers a domain removed before its certificate was bound.
  provisioner "local-exec" {
    when    = destroy
    command = "${self.input.script} delete ${self.input.app} ${self.input.resource_group} ${each.key}"
  }
}

resource "azurerm_container_app_environment_managed_certificate" "spacestate" {
  for_each                     = local.custom_domains
  name                         = replace(each.key, ".", "-")
  container_app_environment_id = azurerm_container_app_environment.spacestate.id
  subject_name                 = each.key
  domain_control_validation    = "CNAME"

  depends_on = [terraform_data.hostname]
}

resource "terraform_data" "bind_certificate" {
  for_each = local.custom_domains

  triggers_replace = [
    azurerm_container_app_environment_managed_certificate.spacestate[each.key].id,
    each.key,
  ]

  input = local.hostname_script

  provisioner "local-exec" {
    command = join(" ", [
      self.input.script, "bind", self.input.app, self.input.resource_group, each.key,
      azurerm_container_app_environment.spacestate.name,
      azurerm_container_app_environment_managed_certificate.spacestate[each.key].id,
    ])
  }

  # Removing a domain destroys this, then the certificate, then the hostname
  # (the reverse of creation). Azure refuses to delete a certificate that is
  # still bound (CertificateInUse), and there is no az command to unbind one,
  # so take the hostname off the app here first.
  provisioner "local-exec" {
    when    = destroy
    command = "${self.input.script} delete ${self.input.app} ${self.input.resource_group} ${self.triggers_replace[1]}"
  }
}

# Hostnames were azurerm_container_app_custom_domain until hostname.sh took
# over attaching them. Forget them rather than destroy them: the live
# hostnames stay, and terraform_data.hostname's add finds them already there.
removed {
  from = azurerm_container_app_custom_domain.spacestate

  lifecycle {
    destroy = false
  }
}
