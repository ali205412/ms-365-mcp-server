#!/usr/bin/env bash
# Mass-grant Azure AD permissions for the ms-365-mcp-server gateway app.
#
# Adds delegated + (optionally) application permissions for all six product
# APIs the gateway can dispatch to: Microsoft Graph, Power BI Service,
# Power Apps, Power Automate, Exchange Online, SharePoint Online.
#
# Prerequisites:
#   - Azure CLI (`az`) installed and logged in:
#       az login --tenant <YOUR_TENANT_ID>
#   - You have at least the "Cloud Application Administrator" role
#     (or Global Admin) — required to grant admin consent.
#
# Usage:
#   bash bin/azure-grant-mcp-permissions.sh                  # delegated only
#   bash bin/azure-grant-mcp-permissions.sh --with-app-only  # also app roles
#   APP_ID=<other-app-id> bash bin/azure-grant-mcp-permissions.sh
#
# Idempotent: re-running adds nothing new because az dedupes; admin-consent
# is safe to repeat.
#
# After running:
#   - For Power BI specifically, also flip the tenant setting:
#     PowerBI Admin Portal → Tenant settings → Developer settings →
#     "Allow service principals to use Power BI APIs" → ON.
#   - For Exchange Online app-only: assign the Exchange Administrator role
#     to the service principal (`a9742f1f-...`) via Roles & Admins in
#     Entra. The Exchange.ManageAsApp scope alone is not enough.
#   - For SharePoint Tenant Admin app-only: assign the SharePoint
#     Administrator role to the SP.

set -euo pipefail

APP_ID="${APP_ID:-a9742f1f-ce26-41d5-9f63-1ae117e54ac7}"
WITH_APP_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --with-app-only) WITH_APP_ONLY=true ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if ! command -v az >/dev/null 2>&1; then
  cat >&2 <<EOF
az CLI not found. Install:
  Linux:   curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
  macOS:   brew install azure-cli
  Windows: winget install -e --id Microsoft.AzureCLI

Then sign in to your tenant:
  az login --tenant <YOUR_TENANT_ID>
EOF
  exit 127
fi

if ! az account show >/dev/null 2>&1; then
  echo "Run 'az login --tenant <YOUR_TENANT_ID>' first." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq required. Install with your package manager." >&2
  exit 127
fi

echo "─────────────────────────────────────────────────────────────"
echo " Granting permissions to app: $APP_ID"
echo " Tenant: $(az account show --query tenantId -o tsv)"
echo " Mode:   $([[ "$WITH_APP_ONLY" == "true" ]] && echo 'delegated + application' || echo 'delegated only')"
echo "─────────────────────────────────────────────────────────────"

# Resolve a list of permission names to az-CLI-compatible "{id}={kind}" args.
# Looks each up in BOTH oauth2PermissionScopes (delegated) and appRoles
# (application). Honors $WITH_APP_ONLY for the application-role half.
build_perms() {
  local resource_app_id="$1"
  local label="$2"
  shift 2
  local names=("$@")

  local sp_json
  sp_json=$(az ad sp show --id "$resource_app_id" 2>/dev/null || echo '')
  if [[ -z "$sp_json" || "$sp_json" == "{}" ]]; then
    echo "  ⚠ '$label' service principal not provisioned in this tenant — skipping."
    echo "    (Some APIs require enabling first; see post-script notes.)"
    return 0
  fi

  local args=()
  for name in "${names[@]}"; do
    local id
    # Delegated scope first
    id=$(echo "$sp_json" | jq -r --arg n "$name" \
      '.oauth2PermissionScopes[]? | select(.value==$n) | .id' | head -1)
    if [[ -n "$id" && "$id" != "null" ]]; then
      args+=("$id=Scope")
      echo "  + $name  (delegated)"
      continue
    fi
    # Application role fallback
    if [[ "$WITH_APP_ONLY" == "true" ]]; then
      id=$(echo "$sp_json" | jq -r --arg n "$name" \
        '.appRoles[]? | select(.value==$n) | .id' | head -1)
      if [[ -n "$id" && "$id" != "null" ]]; then
        args+=("$id=Role")
        echo "  + $name  (application)"
        continue
      fi
    fi
    echo "  ✗ $name  (not found on $label)"
  done

  if [[ ${#args[@]} -gt 0 ]]; then
    # az ad app permission add can warn about consent — that's expected; we
    # consent at the end of the script, not per-permission.
    az ad app permission add --id "$APP_ID" --api "$resource_app_id" \
      --api-permissions "${args[@]}" 2>&1 \
      | grep -v -E "(Invoking |Could not|admin-consent)" || true
  fi
}

# ─── Microsoft Graph ──────────────────────────────────────────────────
echo
echo "▼ Microsoft Graph (00000003-0000-0000-c000-000000000000)"
build_perms "00000003-0000-0000-c000-000000000000" "Microsoft Graph" \
  offline_access openid profile email \
  User.Read User.Read.All People.Read Directory.Read.All \
  Mail.ReadWrite Mail.Send Mail.Read.Shared Mail.Send.Shared \
  MailboxSettings.ReadWrite \
  Calendars.ReadWrite Calendars.Read.Shared \
  Files.ReadWrite Files.Read.All \
  Notes.ReadWrite Notes.Create \
  Tasks.ReadWrite \
  Contacts.ReadWrite \
  Sites.Read.All Sites.ReadWrite.All \
  Group.Read.All Group.ReadWrite.All GroupMember.Read.All \
  Chat.Read Chat.ReadWrite ChatMember.Read \
  ChatMessage.Read ChatMessage.Send \
  Channel.ReadBasic.All Channel.Create Channel.Delete.All \
  ChannelSettings.Read.All ChannelSettings.ReadWrite.All \
  ChannelMessage.Read.All ChannelMessage.Send \
  Team.ReadBasic.All TeamMember.Read.All TeamMember.ReadWrite.All TeamsTab.Read.All \
  OnlineMeetings.ReadWrite \
  OnlineMeetingArtifact.Read.All OnlineMeetingRecording.Read.All OnlineMeetingTranscript.Read.All \
  Presence.Read Presence.Read.All \
  VirtualEvent.Read \
  Place.Read.All Place.ReadWrite.All

# ─── Power BI Service ─────────────────────────────────────────────────
echo
echo "▼ Power BI Service (00000009-0000-0000-c000-000000000000)"
build_perms "00000009-0000-0000-c000-000000000000" "Power BI Service" \
  Tenant.Read.All Tenant.ReadWrite.All \
  Workspace.Read.All Workspace.ReadWrite.All \
  Dataset.Read.All Dataset.ReadWrite.All \
  Report.Read.All Report.ReadWrite.All \
  Dashboard.Read.All Dashboard.ReadWrite.All \
  Capacity.Read.All Capacity.ReadWrite.All \
  Gateway.Read.All Gateway.ReadWrite.All \
  Pipeline.Read.All Pipeline.ReadWrite.All \
  App.Read.All \
  Content.Create \
  StorageAccount.ReadWrite.All \
  UserState.ReadWrite.All

# ─── Power Apps Service ───────────────────────────────────────────────
# AppId for "PowerApps Service": 475226c6-020e-4fb2-8a90-7a972cbfc1d4
echo
echo "▼ Power Apps Service (475226c6-020e-4fb2-8a90-7a972cbfc1d4)"
build_perms "475226c6-020e-4fb2-8a90-7a972cbfc1d4" "Power Apps Service" \
  User Tenant.Read

# ─── Power Automate / Flow Service ────────────────────────────────────
# AppId for "Microsoft Flow Service": 7df0a125-d3be-4c96-aa54-591f83ff541c
echo
echo "▼ Microsoft Flow Service / Power Automate (7df0a125-d3be-4c96-aa54-591f83ff541c)"
build_perms "7df0a125-d3be-4c96-aa54-591f83ff541c" "Power Automate" \
  User Tenant.Read Flows.Read.All Flows.Manage.All

# ─── Office 365 Exchange Online ───────────────────────────────────────
# AppId: 00000002-0000-0ff1-ce00-000000000000
# NOTE: Exchange.ManageAsApp is application-only, so requires --with-app-only.
echo
echo "▼ Office 365 Exchange Online (00000002-0000-0ff1-ce00-000000000000)"
build_perms "00000002-0000-0ff1-ce00-000000000000" "Exchange Online" \
  Exchange.ManageAsApp full_access_as_app

# ─── SharePoint Online ────────────────────────────────────────────────
# AppId: 00000003-0000-0ff1-ce00-000000000000
echo
echo "▼ SharePoint Online (00000003-0000-0ff1-ce00-000000000000)"
build_perms "00000003-0000-0ff1-ce00-000000000000" "SharePoint Online" \
  AllSites.FullControl Sites.FullControl.All

# ─── Admin consent ────────────────────────────────────────────────────
echo
echo "─────────────────────────────────────────────────────────────"
echo " Granting admin consent for all added permissions"
echo "─────────────────────────────────────────────────────────────"
az ad app permission admin-consent --id "$APP_ID"

echo
echo "✓ Done. Verify in:"
echo "  https://entra.microsoft.com → App registrations → $APP_ID → API permissions"
echo
echo "Post-script manual steps (NOT scriptable via az):"
echo "  1. Power BI Admin Portal → Tenant settings →"
echo "     'Allow service principals to use Power BI APIs' → ON"
echo "  2. (For __exo__ tools) Assign 'Exchange Administrator' role to"
echo "     the service principal (Entra → Roles & admins)"
echo "  3. (For __spadmin__ tools) Assign 'SharePoint Administrator'"
echo "     role to the service principal"
echo "  4. Update tenant.sharepoint_domain in Postgres if you'll use __spadmin__:"
echo "     UPDATE tenants SET sharepoint_domain='YOUR_PREFIX' WHERE id='c9514cd6-...';"
