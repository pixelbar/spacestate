#!/usr/bin/env bash
# Every write to the Container App's hostnames, one at a time. Called by the
# provisioners in domain.tf:
#
#   hostname.sh add    <app> <resource-group> <hostname>
#   hostname.sh bind   <app> <resource-group> <hostname> <environment> <certificate-id>
#   hostname.sh delete <app> <resource-group> <hostname>
#
# Each write is a read-modify-write of the app's whole customDomains list, so
# two at once (one apply touching several domains) can drop one of them or
# fail with ContainerAppOperationInProgress. The lock serializes them; a lock
# older than ten minutes is from an apply that was killed mid-write and is
# broken.
#
# add and delete are no-ops when the hostname is already there or already gone.
set -euo pipefail

action="$1" app="$2" rg="$3" host="$4"

lock="$(dirname "$0")/.terraform/hostname.lock"
until mkdir "$lock" 2>/dev/null; do
  if [ -n "$(find "$lock" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
    rmdir "$lock" 2>/dev/null || true
    continue
  fi
  sleep 2
done
trap 'rmdir "$lock"' EXIT

attached() {
  [ "$(az containerapp hostname list -g "$rg" -n "$app" \
    --query "length([?name=='$host'])" -o tsv)" = 1 ]
}

case "$action" in
  add)
    attached || az containerapp hostname add -g "$rg" -n "$app" --hostname "$host" -o none
    ;;
  bind)
    az containerapp hostname bind -g "$rg" -n "$app" --hostname "$host" \
      --environment "$5" --certificate "$6" -o none
    ;;
  delete)
    ! attached || az containerapp hostname delete -g "$rg" -n "$app" --hostname "$host" --yes -o none
    ;;
  *)
    echo "hostname.sh: unknown action '$action'" >&2
    exit 64
    ;;
esac
