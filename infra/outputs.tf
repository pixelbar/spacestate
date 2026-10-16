output "default_fqdn" {
  description = "The Container App's default *.azurecontainerapps.io hostname — target of the manual CNAME record."
  value       = azurerm_container_app.spacestate.ingress[0].fqdn
}

output "domain_verification_id" {
  description = "Value for the manual asuid.<subdomain> TXT record, required before bind_custom_domain can be set to true."
  value       = azurerm_container_app_environment.spacestate.custom_domain_verification_id
}

output "environment_static_ip" {
  description = "Static IP for an A record — only needed if binding the bare apex domain instead of a subdomain."
  value       = azurerm_container_app_environment.spacestate.static_ip_address
}

output "storage_account_name" {
  description = "Used to construct the CONFIG_SOURCE blob:// URL and for uploading the initial config blobs."
  value       = azurerm_storage_account.spacestate.name
}

output "config_container_name" {
  value = azurerm_storage_container.config.name
}
