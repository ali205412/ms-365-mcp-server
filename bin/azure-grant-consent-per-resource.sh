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
#   bash bin/azure-grant-consent-per-resource.sh --allow-extra
#
# Prerequisites:
#   - az CLI logged in to the target tenant
#   - Bulk add already done (bin/azure-grant-mcp-permissions.sh)

set -euo pipefail

APP_ID="${APP_ID:-a9742f1f-ce26-41d5-9f63-1ae117e54ac7}"
ALLOW_EXTRA=false
for arg in "$@"; do
  case "$arg" in
    --allow-extra) ALLOW_EXTRA=true ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

EXPECTED_RESOURCE_APP_IDS=(
  "00000003-0000-0000-c000-000000000000" # Microsoft Graph
  "00000009-0000-0000-c000-000000000000" # Power BI Service
  "475226c6-020e-4fb2-8a90-7a972cbfc1d4" # Power Apps Service
  "7df0a125-d3be-4c96-aa54-591f83ff541c" # Microsoft Flow Service
  "00000002-0000-0ff1-ce00-000000000000" # Exchange Online
  "00000003-0000-0ff1-ce00-000000000000" # SharePoint Online
)

declare -A EXPECTED_PERMISSION_VALUES
EXPECTED_PERMISSION_VALUES["00000003-0000-0000-c000-000000000000"]="offline_access openid profile email User.Read User.Read.All People.Read Directory.Read.All Mail.ReadWrite Mail.Send Mail.Read.Shared Mail.Send.Shared MailboxSettings.ReadWrite Calendars.ReadWrite Calendars.Read.Shared Files.ReadWrite Files.Read.All Notes.ReadWrite Notes.Create Tasks.ReadWrite Contacts.ReadWrite Sites.Read.All Sites.ReadWrite.All Group.Read.All Group.ReadWrite.All GroupMember.Read.All Chat.Read Chat.ReadWrite ChatMember.Read ChatMessage.Read ChatMessage.Send Channel.ReadBasic.All Channel.Create Channel.Delete.All ChannelSettings.Read.All ChannelSettings.ReadWrite.All ChannelMessage.Read.All ChannelMessage.Send Team.ReadBasic.All TeamMember.Read.All TeamMember.ReadWrite.All TeamsTab.Read.All OnlineMeetings.ReadWrite OnlineMeetingArtifact.Read.All OnlineMeetingRecording.Read.All OnlineMeetingTranscript.Read.All Presence.Read Presence.Read.All VirtualEvent.Read Place.Read.All Place.ReadWrite.All"
EXPECTED_PERMISSION_VALUES["00000009-0000-0000-c000-000000000000"]="Tenant.Read.All Tenant.ReadWrite.All Workspace.Read.All Workspace.ReadWrite.All Dataset.Read.All Dataset.ReadWrite.All Report.Read.All Report.ReadWrite.All Dashboard.Read.All Dashboard.ReadWrite.All Capacity.Read.All Capacity.ReadWrite.All Gateway.Read.All Gateway.ReadWrite.All Pipeline.Read.All Pipeline.ReadWrite.All App.Read.All Content.Create StorageAccount.ReadWrite.All UserState.ReadWrite.All"
EXPECTED_PERMISSION_VALUES["475226c6-020e-4fb2-8a90-7a972cbfc1d4"]="User Tenant.Read"
EXPECTED_PERMISSION_VALUES["7df0a125-d3be-4c96-aa54-591f83ff541c"]="User Tenant.Read Flows.Read.All Flows.Manage.All"
EXPECTED_PERMISSION_VALUES["00000002-0000-0ff1-ce00-000000000000"]="Exchange.ManageAsApp full_access_as_app"
EXPECTED_PERMISSION_VALUES["00000003-0000-0ff1-ce00-000000000000"]="AllSites.FullControl Sites.FullControl.All"

contains_word() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

permission_allowed() {
  local resource_app_id="$1"
  local permission_value="$2"
  # shellcheck disable=SC2086
  contains_word "$permission_value" ${EXPECTED_PERMISSION_VALUES[$resource_app_id]:-}
}

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

REQUIRED_ACCESS_JSON=$(az ad app show --id "$APP_ID" --query "requiredResourceAccess" -o json)

validate_required_access() {
  local json="$1"
  local violations=0
  while read -r RESOURCE; do
    local res_app_id
    res_app_id=$(echo "$RESOURCE" | jq -r '.resourceAppId')
    if ! contains_word "$res_app_id" "${EXPECTED_RESOURCE_APP_IDS[@]}"; then
      echo "Unexpected resource in requiredResourceAccess: $res_app_id" >&2
      violations=$((violations + 1))
      continue
    fi

    local res_sp_json
    res_sp_json=$(az ad sp show --id "$res_app_id" 2>/dev/null || echo '')
    [[ -z "$res_sp_json" || "$res_sp_json" == "{}" ]] && continue

    while read -r ACCESS; do
      local access_type access_id name
      access_type=$(echo "$ACCESS" | jq -r '.type')
      access_id=$(echo "$ACCESS" | jq -r '.id')
      if [[ "$access_type" == "Scope" ]]; then
        name=$(echo "$res_sp_json" | jq -r --arg i "$access_id" '.oauth2PermissionScopes[]? | select(.id==$i) | .value' | head -1)
      else
        name=$(echo "$res_sp_json" | jq -r --arg i "$access_id" '.appRoles[]? | select(.id==$i) | .value' | head -1)
      fi

      if [[ -z "$name" || "$name" == "null" ]]; then
        echo "Unexpected permission id on $res_app_id: $access_type/$access_id (not resolvable)" >&2
        violations=$((violations + 1))
      elif ! permission_allowed "$res_app_id" "$name"; then
        echo "Unexpected permission on $res_app_id: $name ($access_type/$access_id)" >&2
        violations=$((violations + 1))
      fi
    done < <(echo "$RESOURCE" | jq -c '.resourceAccess[]')
  done < <(echo "$json" | jq -c '.[]')

  if [[ "$violations" -gt 0 && "$ALLOW_EXTRA" != "true" ]]; then
    echo "Refusing to grant consent for unexpected permissions. Re-run with --allow-extra only after manual review." >&2
    exit 3
  fi
}

validate_required_access "$REQUIRED_ACCESS_JSON"

# Pull the app's full requiredResourceAccess and iterate one resource at a
# time. We re-resolve scope names + role names from each resource SP to keep
# this script independent of the prior add step's hardcoded list.
echo "$REQUIRED_ACCESS_JSON" \
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
