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
# fail with ContainerAppOperationInProgress. An exclusive flock serializes
# them. The kernel releases it when this process exits, however it exits, so
# an apply killed mid-write leaves no stale lock to break. macOS has no
# flock(1), so perl takes the lock and re-runs this script holding it. The
# lock lives in Terraform's data directory (`just tf-dev` uses .terraform-dev).
#
# add and delete are no-ops when the hostname is already there or already gone.
set -euo pipefail

if [ -z "${HOSTNAME_SH_LOCKED:-}" ]; then
  export HOSTNAME_SH_LOCKED=1
  # $^F keeps the locked handle open across exec (perl closes it otherwise).
  exec perl -MFcntl=:flock -e '
    $^F = 255;
    open(my $fh, ">>", shift) or die "hostname.sh: lock: $!\n";
    flock($fh, LOCK_EX) or die "hostname.sh: lock: $!\n";
    exec(@ARGV) or die "hostname.sh: exec: $!\n";
  ' "${TF_DATA_DIR:-$(dirname "$0")/.terraform}/hostname.lock" "$0" "$@"
fi

action="$1" app="$2" rg="$3" host="$4"

# Fails the script, not just the test, when az does: a failed lookup must not
# read as "not attached" and make delete skip silently.
attached() {
  local count
  count="$(az containerapp hostname list -g "$rg" -n "$app" \
    --query "length([?name=='$host'])" -o tsv)" || exit 1
  case "$count" in
    0) return 1 ;;
    1) return 0 ;;
    *)
      echo "hostname.sh: unexpected hostname count for $host: '$count'" >&2
      exit 1
      ;;
  esac
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
