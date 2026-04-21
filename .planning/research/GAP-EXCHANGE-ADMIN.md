# Exchange Admin REST v2 — Coverage Gap

**Source of truth:** https://learn.microsoft.com/en-us/exchange/reference/admin-api-endpoints-reference (VERIFIED 2026-04-20).
**Covered by Phase 5.1:** 10 cmdlets across 6 endpoints (see `openapi/openapi-exo.yaml`).
**Gap:** ~240 Exchange Online cmdlets lack REST v2 coverage as of 2026-04-20. This file catalogues them as future-backlog material — either awaiting Microsoft REST v2 expansion or deferred to a future phase that brings PowerShell remoting (see 05.1-CONTEXT D-02).

**Escalation paths for uncovered cmdlets:**

1. **Microsoft REST v2 roadmap** — check `admin-api-endpoints-reference` periodically; add endpoints as Microsoft ships them. Trigger: STRICT churn guard fires on addition → operators accept via `MS365_MCP_ACCEPT_EXO_CHURN=1` and update the hand-authored spec + this gap file.
2. **PowerShell remoting** — deferred per 05.1-CONTEXT D-02; tracked for a future phase if tenant demand emerges. WSMan/OAuth would require stateful-session shims onto the stateless MCP request/response shape.
3. **Out-of-band operator script** — operators run Exchange Online PowerShell directly for uncovered cmdlets.

## Covered by REST v2 (in `openapi-exo.yaml`)

The hand-authored spec models these 10 cmdlets across 6 REST v2 endpoints. Both counts are enforced by the STRICT churn guard.

| Endpoint | Method | operationId | Cmdlet |
|----------|--------|-------------|--------|
| /OrganizationConfig | GET | get-organization-config | Get-OrganizationConfig |
| /AcceptedDomain | GET | get-accepted-domain | Get-AcceptedDomain |
| /Mailbox | GET | get-mailbox | Get-Mailbox |
| /Mailbox | POST | set-mailbox | Set-Mailbox |
| /MailboxFolderPermission | GET | get-mailbox-folder-permission | Get-MailboxFolderPermission |
| /MailboxFolderPermission | POST | add-mailbox-folder-permission | Add-MailboxFolderPermission |
| /MailboxFolderPermission | PUT | set-mailbox-folder-permission | Set-MailboxFolderPermission |
| /MailboxFolderPermission | DELETE | remove-mailbox-folder-permission | Remove-MailboxFolderPermission |
| /DistributionGroupMember | GET | get-distribution-group-member | Get-DistributionGroupMember |
| /DynamicDistributionGroupMember | GET | get-dynamic-distribution-group-member | Get-DynamicDistributionGroupMember |

## Cmdlets Not Yet in REST v2

### Transport Rules (~20 cmdlets)

Mail-flow rules, transport configuration, and transport agents. No REST v2 coverage.

- Get-TransportRule, Set-TransportRule, New-TransportRule, Remove-TransportRule
- Enable-TransportRule, Disable-TransportRule
- Get-TransportRuleAction, Get-TransportRulePredicate
- Get-TransportConfig, Set-TransportConfig
- Get-TransportAgent, Enable-TransportAgent, Disable-TransportAgent, Install-TransportAgent, Uninstall-TransportAgent
- Get-TransportServer (legacy; on-prem EMS only)
- Get-HybridConfiguration, Set-HybridConfiguration
- Get-HybridMailflow, Set-HybridMailflow
- Test-MailFlow

### Retention Policies (~25 cmdlets)

Retention policies, retention tags, and case-based hold. No REST v2 coverage.

- Get-RetentionPolicy, Set-RetentionPolicy, New-RetentionPolicy, Remove-RetentionPolicy
- Get-RetentionPolicyTag, Set-RetentionPolicyTag, New-RetentionPolicyTag, Remove-RetentionPolicyTag
- Get-MailboxRetentionPolicy, Set-MailboxRetentionPolicy
- Start-ManagedFolderAssistant
- Get-ComplianceCase, Set-ComplianceCase, New-ComplianceCase, Remove-ComplianceCase
- Get-ComplianceCaseMember, Add-ComplianceCaseMember, Remove-ComplianceCaseMember
- Get-CaseHoldPolicy, New-CaseHoldPolicy, Set-CaseHoldPolicy, Remove-CaseHoldPolicy
- Get-CaseHoldRule, New-CaseHoldRule, Set-CaseHoldRule, Remove-CaseHoldRule
- Get-HoldCompliancePolicy, New-HoldCompliancePolicy

### Anti-Spam / Anti-Malware (~30 cmdlets)

Hosted content filtering, anti-phish, safe links, safe attachments. No REST v2 coverage.

- Get-HostedContentFilterPolicy, Set-HostedContentFilterPolicy, New-HostedContentFilterPolicy, Remove-HostedContentFilterPolicy
- Get-HostedContentFilterRule, Set-HostedContentFilterRule, New-HostedContentFilterRule, Remove-HostedContentFilterRule
- Get-MalwareFilterPolicy, Set-MalwareFilterPolicy, New-MalwareFilterPolicy, Remove-MalwareFilterPolicy
- Get-MalwareFilterRule, Set-MalwareFilterRule, New-MalwareFilterRule, Remove-MalwareFilterRule
- Get-AntiPhishPolicy, Set-AntiPhishPolicy, New-AntiPhishPolicy, Remove-AntiPhishPolicy
- Get-AntiPhishRule, Set-AntiPhishRule, New-AntiPhishRule, Remove-AntiPhishRule
- Get-SafeLinksPolicy, Set-SafeLinksPolicy, New-SafeLinksPolicy, Remove-SafeLinksPolicy
- Get-SafeAttachmentPolicy, Set-SafeAttachmentPolicy, New-SafeAttachmentPolicy, Remove-SafeAttachmentPolicy
- Get-HostedOutboundSpamFilterPolicy, Set-HostedOutboundSpamFilterPolicy

### eDiscovery / Compliance Search (~20 cmdlets)

Compliance and eDiscovery search, case management, and content review. No REST v2 coverage.

- Get-ComplianceSearch, New-ComplianceSearch, Set-ComplianceSearch, Remove-ComplianceSearch
- Start-ComplianceSearch, Stop-ComplianceSearch
- Get-ComplianceSearchAction, New-ComplianceSearchAction, Remove-ComplianceSearchAction
- Get-eDiscoveryCase, New-eDiscoveryCase, Set-eDiscoveryCase, Remove-eDiscoveryCase
- Get-eDiscoveryCaseMember, Add-eDiscoveryCaseMember, Remove-eDiscoveryCaseMember
- Get-eDiscoveryCaseHoldPolicy, New-eDiscoveryCaseHoldPolicy
- Get-eDiscoveryCaseSearch, New-eDiscoveryCaseSearch
- Get-ComplianceReviewSet

### Mobile Device Management (ABQ) (~15 cmdlets)

ActiveSync device policy, mobile device access, and device quarantine. No REST v2 coverage.

- Get-ActiveSyncDevice, Set-ActiveSyncDevice, Clear-ActiveSyncDevice, Remove-ActiveSyncDevice
- Get-ActiveSyncDeviceStatistics
- Get-ActiveSyncDeviceClass
- Get-ActiveSyncOrganizationSettings, Set-ActiveSyncOrganizationSettings
- Get-ActiveSyncMailboxPolicy, Set-ActiveSyncMailboxPolicy, New-ActiveSyncMailboxPolicy, Remove-ActiveSyncMailboxPolicy
- Get-MobileDeviceMailboxPolicy, Set-MobileDeviceMailboxPolicy
- Get-MobileDevice, Remove-MobileDevice
- Clear-MobileDevice

### Connectors / Hybrid (~25 cmdlets)

Inbound/outbound mail connectors, remote domains, federation, on-prem organization relationships. No REST v2 coverage.

- Get-InboundConnector, Set-InboundConnector, New-InboundConnector, Remove-InboundConnector
- Get-OutboundConnector, Set-OutboundConnector, New-OutboundConnector, Remove-OutboundConnector
- Test-OutboundConnector
- Get-RemoteDomain, Set-RemoteDomain, New-RemoteDomain, Remove-RemoteDomain
- Get-OnPremisesOrganization, Set-OnPremisesOrganization, New-OnPremisesOrganization, Remove-OnPremisesOrganization
- Get-FederationTrust, Set-FederationTrust, New-FederationTrust, Remove-FederationTrust
- Get-FederatedDomainProof
- Get-OrganizationRelationship, Set-OrganizationRelationship, New-OrganizationRelationship, Remove-OrganizationRelationship
- Test-OrganizationRelationship

### Recipient Management (~40 cmdlets)

Mailbox, mail user, mail contact, user lifecycle, and group lifecycle beyond the covered Get-Mailbox / Set-Mailbox pair. No REST v2 coverage.

- New-Mailbox, Remove-Mailbox, Enable-Mailbox, Disable-Mailbox
- Get-MailboxStatistics, Get-MailboxFolderStatistics
- Get-User, Set-User
- Get-MailUser, Set-MailUser, New-MailUser, Remove-MailUser, Enable-MailUser, Disable-MailUser
- Get-MailContact, Set-MailContact, New-MailContact, Remove-MailContact
- Get-Contact, Set-Contact
- Get-Group, Set-Group
- Get-DistributionGroup, Set-DistributionGroup, New-DistributionGroup, Remove-DistributionGroup, Enable-DistributionGroup, Disable-DistributionGroup
- Add-DistributionGroupMember, Remove-DistributionGroupMember
- Get-DynamicDistributionGroup, Set-DynamicDistributionGroup, New-DynamicDistributionGroup, Remove-DynamicDistributionGroup
- Get-UnifiedGroup, Set-UnifiedGroup, New-UnifiedGroup, Remove-UnifiedGroup
- Add-UnifiedGroupLinks, Remove-UnifiedGroupLinks
- Get-Recipient (bulk read)
- Get-RecipientPermission, Add-RecipientPermission, Remove-RecipientPermission

### Message Trace / Reporting (~10 cmdlets)

Mail trace, message tracking, delivery reports. No REST v2 coverage.

- Get-MessageTrace, Get-MessageTraceDetail
- Get-MessageTrackingReport, Get-MessageTrackingLog
- Get-HistoricalSearch, Start-HistoricalSearch, Stop-HistoricalSearch
- Get-MailTrafficReport, Get-MailTrafficSummary
- Get-MailDetailReport

### Calendar & Scheduling (~15 cmdlets)

Calendar processing, resource mailbox configuration, and room lists. No REST v2 coverage.

- Get-CalendarProcessing, Set-CalendarProcessing
- Get-CalendarDiagnosticLog, Get-CalendarDiagnosticAnalysis
- Get-RoomList, Set-RoomList, New-RoomList, Remove-RoomList
- Add-DistributionGroupMember (for room list members)
- Get-ResourceConfig, Set-ResourceConfig
- Get-PlaceV3
- Set-MailboxCalendarConfiguration
- Get-MailboxCalendarConfiguration

### RBAC / Role Management (~20 cmdlets)

Role-based access control, role groups, management scopes. No REST v2 coverage.

- Get-RoleGroup, Set-RoleGroup, New-RoleGroup, Remove-RoleGroup
- Add-RoleGroupMember, Remove-RoleGroupMember, Update-RoleGroupMember
- Get-ManagementRole, Set-ManagementRole, New-ManagementRole, Remove-ManagementRole
- Get-ManagementRoleAssignment, New-ManagementRoleAssignment, Remove-ManagementRoleAssignment
- Get-ManagementRoleEntry, Set-ManagementRoleEntry, Add-ManagementRoleEntry, Remove-ManagementRoleEntry
- Get-ManagementScope, Set-ManagementScope, New-ManagementScope, Remove-ManagementScope
- Get-RoleAssignmentPolicy, Set-RoleAssignmentPolicy, New-RoleAssignmentPolicy

### Other (~20 cmdlets)

Miscellaneous cmdlets that don't fit above categories — frontend transport (on-prem only), send/receive connectors (on-prem only), journaling, public folders.

- Get-FrontendTransportService (on-prem only; not applicable to EXO)
- Get-ReceiveConnector, Get-SendConnector (on-prem only; not applicable to EXO)
- Get-JournalRule, Set-JournalRule, New-JournalRule, Remove-JournalRule
- Get-PublicFolder, Set-PublicFolder, New-PublicFolder, Remove-PublicFolder
- Get-PublicFolderMailbox, Set-PublicFolderMailbox, New-PublicFolderMailbox
- Get-PublicFolderClientPermission, Add-PublicFolderClientPermission, Remove-PublicFolderClientPermission
- Get-AdminAuditLogConfig, Set-AdminAuditLogConfig
- Search-AdminAuditLog
- Search-MailboxAuditLog
- Get-OwaMailboxPolicy, Set-OwaMailboxPolicy

## Coverage Summary

| Area | Total Cmdlets (estimated) | In REST v2 | Gap |
|------|---------------------------|------------|-----|
| Organization config | 1 | 1 | 0 |
| Accepted domains | 3 | 1 | 2 |
| Mailbox read/set | 2 | 2 | 0 |
| Mailbox folder permissions | 4 | 4 | 0 |
| Distribution groups (member read) | 1 | 1 | 0 |
| Dynamic distribution groups (member read) | 1 | 1 | 0 |
| Transport rules | ~20 | 0 | ~20 |
| Retention policies | ~25 | 0 | ~25 |
| Anti-spam / anti-malware | ~30 | 0 | ~30 |
| eDiscovery / compliance search | ~20 | 0 | ~20 |
| Mobile device management (ABQ) | ~15 | 0 | ~15 |
| Connectors / hybrid | ~25 | 0 | ~25 |
| Recipient management | ~40 | 0 | ~40 |
| Message trace / reporting | ~10 | 0 | ~10 |
| Calendar & scheduling | ~15 | 0 | ~15 |
| RBAC / role management | ~20 | 0 | ~20 |
| Other | ~20 | 0 | ~20 |
| **TOTAL** | **~250** | **10** | **~240** |

## Next Review

On every Microsoft announcement of new REST v2 endpoints — or any time STRICT churn fires (i.e., any time `MS365_MCP_ACCEPT_EXO_CHURN=1` is required to update the snapshot) — audit this file:

1. Remove cmdlets now covered by REST v2 from the gap sections.
2. Move the newly-covered cmdlets into the "Covered by REST v2" table.
3. Add any newly-identified gaps surfaced by the upstream docs.
4. Adjust the Coverage Summary totals.

This file is a living document; its single source of truth is `admin-api-endpoints-reference` (referenced at the top). Diverge only with commit-message justification.
