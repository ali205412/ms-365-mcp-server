#!/usr/bin/env bash
# Grant admin consent per-resource — bypasses Microsoft's 8000-char combined
# DelegationScope limit that breaks `az ad app permission admin-consent`
# when an app's requiredResourceAccess crosses many APIs (Graph + Power BI +
# Power Apps + Power Automate + Exchange + SharePoint hits ~10800 chars).
#
# This script reads the app's already-added requiredResourceAccess (set by
# bin/azure-grant-mcp-permissions.sh in the prior step) and consents each
# resource independently:
#   - Delegated scopes  → az ad app permission grant --api <res>
#   - Application roles → POST /v1.0/servicePrincipals/.../appRoleAssignments
#
# Usage:
#   bash bin/azure-grant-consent-per-resource.sh
#   APP_ID=<other> bash bin/azure-grant-consent-per-resource.sh
#
# Prerequisites:
#   - az CLI logged in to the target tenant
#   - Bulk add already done (bin/azure-grant-mcp-permissions.sh)

set -euo pipefail

APP_ID="${APP_ID:-a9742f1f-ce26-41d5-9f63-1ae117e54ac7}"

if ! command -v az >/dev/null 2>&1; then
  echo "az CLI not found." >&2
  exit 127
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "jq required." >&2
  exit 127
fi
if ! az account show >/dev/null 2>&1; then
  echo "Run 'az login --tenant <YOUR_TENANT_ID>' first." >&2
  exit 1
fi

echo "─────────────────────────────────────────────────────────────"
echo " Per-resource admin consent for app: $APP_ID"
echo "─────────────────────────────────────────────────────────────"

# Resolve our app's service principal — needed as principalId for app role
# assignments (the SP receives the role; the app itself doesn't).
APP_SP_ID=$(az ad sp show --id "$APP_ID" --query "id" -o tsv)
echo "App SP id: $APP_SP_ID"

# Pull the app's full requiredResourceAccess and iterate one resource at a
# time. We re-resolve scope names + role names from each resource SP to keep
# this script independent of the prior add step's hardcoded list.
az ad app show --id "$APP_ID" --query "requiredResourceAccess" -o json \
  | jq -c '.[]' | while read -r RESOURCE; do

  RES_APP_ID=$(echo "$RESOURCE" | jq -r '.resourceAppId')
  RES_SP_JSON=$(az ad sp show --id "$RES_APP_ID" 2>/dev/null || echo '')

  if [[ -z "$RES_SP_JSON" ]]; then
    echo
    echo "▼ $RES_APP_ID — service principal not found, skipping"
    continue
  fi

  RES_NAME=$(echo "$RES_SP_JSON" | jq -r '.displayName')
  RES_SP_ID=$(echo "$RES_SP_JSON" | jq -r '.id')
  echo
  echo "▼ $RES_NAME ($RES_APP_ID)"

  # ── Delegated scopes for this resource ────────────────────────────
  SCOPE_NAMES=""
  for SCOPE_ID in $(echo "$RESOURCE" | jq -r '.resourceAccess[] | select(.type=="Scope") | .id'); do
    NAME=$(echo "$RES_SP_JSON" | jq -r --arg i "$SCOPE_ID" '.oauth2PermissionScopes[]? | select(.id==$i) | .value')
    [[ -n "$NAME" && "$NAME" != "null" ]] && SCOPE_NAMES="$SCOPE_NAMES $NAME"
  done
  SCOPE_NAMES=$(echo "$SCOPE_NAMES" | xargs)  # trim
  if [[ -n "$SCOPE_NAMES" ]]; then
    SCOPE_LEN=${#SCOPE_NAMES}
    echo "  Delegated ($SCOPE_LEN chars): granting via 'az ad app permission grant'"
    if ! az ad app permission grant --id "$APP_ID" --api "$RES_APP_ID" --scope "$SCOPE_NAMES" \
        --query "id" -o tsv 2>&1 | head -3 | sed 's/^/    /'; then
      echo "    (grant returned non-zero — may already be consented; check portal)"
    fi
  fi

  # ── Application roles for this resource ──────────────────────────
  for ROLE_ID in $(echo "$RESOURCE" | jq -r '.resourceAccess[] | select(.type=="Role") | .id'); do
    ROLE_NAME=$(echo "$RES_SP_JSON" | jq -r --arg i "$ROLE_ID" '.appRoles[]? | select(.id==$i) | .value')
    echo "  App role: $ROLE_NAME"
    # Idempotent: POST returns 201 first time, 400 'already assigned' subsequently.
    BODY=$(jq -nc --arg p "$APP_SP_ID" --arg r "$RES_SP_ID" --arg a "$ROLE_ID" \
      '{principalId:$p, resourceId:$r, appRoleId:$a}')
    RESULT=$(az rest --method POST \
      --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$APP_SP_ID/appRoleAssignments" \
      --headers "Content-Type=application/json" \
      --body "$BODY" 2>&1 || true)
    if echo "$RESULT" | grep -q "Permission being assigned already exists"; then
      echo "    already assigned"
    elif echo "$RESULT" | grep -q '"id"'; then
      echo "    granted"
    else
      echo "    $(echo "$RESULT" | head -2 | tr '\n' ' ')"
    fi
  done
done

echo
echo "─────────────────────────────────────────────────────────────"
echo "Done. Verify in Entra portal → App registrations → $APP_ID →"
echo "API permissions: every line should show 'Granted for <tenant>' in"
echo "the Status column."
echo "─────────────────────────────────────────────────────────────"
