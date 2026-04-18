# Microsoft Graph API Coverage Gap Report

_Generated 2026-04-18 from upstream docs at `/tmp/microsoft-graph-docs-contrib`_

## Executive Summary

| Metric | Value |
|---|---|
| Tools currently exposed (`src/endpoints.json`) | **212** |
| Unique tool keys (METHOD + canonical path) | **211** |
| Tools that match a v1.0 Graph operation | **172** (the rest target paths only documented in beta or use variant URLs) |
| Unique v1.0 operations across all workloads | **5021** |
| Unique beta operations across all workloads | **8926** |
| **Unique v1.0 coverage** | **172 / 5021 = 3.4%** |
| Total v1.0 op-rows (with workload duplicates, since ops appear in multiple TOCs) | 5963 |
| Total beta op-rows | 11088 |
| Sum-of-workload v1.0 coverage | 243 / 5963 = 4.1% |

_Note: counts of "v1.0 ops" in per-workload tables below include duplication where the same operation is surfaced in multiple workload TOCs (e.g. `/me/messages` shows up under both **Mail** and **Users**). The unique numbers in this summary dedup across workloads._

### High-priority workload coverage at a glance

| Workload | v1.0 Covered | v1.0 Total | % | Priority |
|---|---:|---:|---:|---|
| Mail (Outlook) | 34 | 333 | 10.2% | HIGH |
| Calendars | 43 | 503 | 8.5% | HIGH |
| Files / OneDrive | 14 | 273 | 5.1% | HIGH |
| Teams & Communications | 49 | 456 | 10.7% | HIGH |
| Users | 41 | 303 | 13.5% | HIGH |
| Groups | 13 | 196 | 6.6% | HIGH |
| SharePoint Sites & Lists | 7 | 166 | 4.2% | HIGH |
| Planner / Tasks | 7 | 25 | 28.0% | HIGH |
| To Do Tasks | 9 | 49 | 18.4% | HIGH |
| Identity & Access | 0 | 809 | 0.0% | HIGH |
| OneNote | 9 | 116 | 7.8% | MED |
| Personal Contacts | 14 | 190 | 7.4% | MED |
| Search | 1 | 16 | 6.3% | MED |
| Reports | 0 | 109 | 0.0% | MED |
| Security | 0 | 312 | 0.0% | MED |

## Per-Workload Coverage Table (all workloads)

Sorted by priority (HIGH → LOW), then by v1.0 op count (desc).

| Workload | v1.0 Ops | Beta Ops | Covered | Missing (v1) | % v1 | Priority |
|---|---:|---:|---:|---:|---:|---|
| Identity & Access | 809 | 1675 | 0 | 809 | 0.0% | HIGH |
| Calendars | 503 | 581 | 43 | 460 | 8.5% | HIGH |
| Teams & Communications | 456 | 581 | 49 | 407 | 10.7% | HIGH |
| Mail (Outlook) | 333 | 434 | 34 | 299 | 10.2% | HIGH |
| Users | 303 | 357 | 41 | 262 | 13.5% | HIGH |
| Files / OneDrive | 273 | 399 | 14 | 259 | 5.1% | HIGH |
| Groups | 196 | 217 | 13 | 183 | 6.6% | HIGH |
| SharePoint Sites & Lists | 166 | 317 | 7 | 159 | 4.2% | HIGH |
| To Do Tasks | 49 | 256 | 9 | 40 | 18.4% | HIGH |
| Planner / Tasks | 25 | 78 | 7 | 18 | 28.0% | HIGH |
| Intune Device & App Mgmt | 749 | 2647 | 0 | 749 | 0.0% | MED |
| Excel Workbooks | 583 | 593 | 0 | 583 | 0.0% | MED |
| Security | 312 | 401 | 0 | 312 | 0.0% | MED |
| Applications (App Registrations) | 246 | 306 | 0 | 246 | 0.0% | MED |
| Personal Contacts | 190 | 276 | 14 | 176 | 7.4% | MED |
| OneNote | 116 | 120 | 9 | 107 | 7.8% | MED |
| Reports | 109 | 234 | 0 | 109 | 0.0% | MED |
| People & Workplace Intel | 32 | 239 | 2 | 30 | 6.3% | MED |
| Compliance | 16 | 83 | 0 | 16 | 0.0% | MED |
| Search | 16 | 16 | 1 | 15 | 6.3% | MED |
| Employee Experience (Viva) | 12 | 19 | 0 | 12 | 0.0% | MED |
| Change Notifications (Subscriptions) | 6 | 7 | 0 | 6 | 0.0% | MED |
| Education | 104 | 120 | 0 | 104 | 0.0% | LOW |
| Copilot Agents | 90 | 126 | 0 | 90 | 0.0% | LOW |
| Backup Storage | 83 | 98 | 0 | 83 | 0.0% | LOW |
| Extensions | 83 | 106 | 0 | 83 | 0.0% | LOW |
| Bookings | 37 | 37 | 0 | 37 | 0.0% | LOW |
| External Data Connections | 17 | 17 | 0 | 17 | 0.0% | LOW |
| Tenant Management | 14 | 40 | 0 | 14 | 0.0% | LOW |
| Tenants | 14 | 40 | 0 | 14 | 0.0% | LOW |
| Cross-Device Experiences | 12 | 20 | 0 | 12 | 0.0% | LOW |
| Partner Billing Reports | 6 | 0 | 0 | 6 | 0.0% | LOW |
| Audit Log Query | 3 | 0 | 0 | 3 | 0.0% | LOW |
| agents-(preview) | 0 | 123 | 0 | 0 | N/A% | LOW |
| data-security-and-governance-(preview) | 0 | 0 | 0 | 0 | N/A% | LOW |
| financials-(preview) | 0 | 77 | 0 | 0 | N/A% | LOW |
| industry-data-etl-(preview) | 0 | 50 | 0 | 0 | N/A% | LOW |
| mailbox-import-and-export | 0 | 184 | 0 | 0 | N/A% | LOW |
| mailbox-import-and-export-(preview) | 0 | 184 | 0 | 0 | N/A% | LOW |
| notifications-(deprecated) | 0 | 1 | 0 | 0 | N/A% | LOW |
| tenant-administration | 0 | 15 | 0 | 0 | N/A% | LOW |
| tenant-administration-(preview) | 0 | 14 | 0 | 0 | N/A% | LOW |

## Missing Operations by Workload (Top 15 priority workloads)

For each workload, every v1.0 operation in the upstream TOC that we do NOT currently expose. URLs are shown raw (Graph documentation form). Description is from the markdown title where available.

### Mail (Outlook) — 299 missing of 333

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/groups/{id}/threads/{id}/posts/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/calendar/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/calendars/{id}/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/inferenceClassification/overrides/{id}` | Delete inferenceClassificationOverride |
| DELETE | `/me/mailFolders/{id}/childFolders/{id}/.../messages/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/mailFolders/{id}/messages/{id}` | Delete message |
| DELETE | `/me/mailFolders/{id}/messages/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/mailFolders/inbox/messageRules/{id}` | Delete messageRule |
| DELETE | `/me/outlook/masterCategories/{id}` | Delete outlookCategory |
| DELETE | `/users/{id \| userPrincipalName}/calendar/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id \| userPrincipalName}/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id}/inferenceClassification/overrides/{id}` | Delete inferenceClassificationOverride |
| DELETE | `/users/{id \| userPrincipalName}/mailFolders/{id}` | Delete mailFolder |
| DELETE | `/users/{id \| userPrincipalName}/mailFolders/{id}/childFolders/{id}/messages/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}` | Delete message |
| DELETE | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id \| userPrincipalName}/mailFolders/inbox/messageRules/{id}` | Delete messageRule |
| DELETE | `/users/{id \| userPrincipalName}/messages/{id}` | Delete message |
| DELETE | `/users/{id \| userPrincipalName}/messages/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id\|userPrincipalName}/outlook/masterCategories/{id}` | Delete outlookCategory |
| GET | `/admin/exchange/tracing/messageTraces` | List messageTraces |
| GET | `/admin/exchange/tracing/messageTraces/{exchangeMessageTraceId}/getDetailsByRecipient(recipientAddress='parameterValue')` | exchangeMessageTrace: getDetailsByRecipient |
| GET | `/devices/{Id}?$expand=extensions($filter=id eq '{extensionId}')&$select=id,{property_1},{property_n}` | Get open extension |
| GET | `/devices/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/groups/{Id}?$expand=extensions($filter=id eq '{extensionId}')&$select=id,{property_1},{property_n}` | Get open extension |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/attachments` | List attachments |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/attachments/{id}` | Get attachment |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/groups/{Id}/events?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/groups/{id}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{Id}/events/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/groups/{id}/events/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/groups/{id}/events/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{Id}/events/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/groups/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/groups/{Id}/threads/{Id}/posts?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/groups/{id}/threads/{id}/posts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{Id}/threads/{Id}/posts/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/groups/{id}/threads/{id}/posts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/groups/{id}/threads/{id}/posts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/threads/{id}/posts/{id}/attachments` | List attachments |
| GET | `/groups/{id}/threads/{id}/posts/{id}/attachments/{id}` | Get attachment |
| GET | `/groups/{id}/threads/{id}/posts/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/groups/{Id}/threads/{Id}/posts/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/me/calendar/events/{id}/attachments` | List attachments |
| GET | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/attachments` | List attachments |
| GET | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/attachments/{id}` | Get attachment |
| GET | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/me/calendars?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/calendars/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/calendars/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/calendars/{id}/events/{id}/attachments` | List attachments |
| GET | `/me/calendars/{id}/events/{id}/attachments/{id}` | Get attachment |
| GET | `/me/calendars/{id}/events/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/me/contactfolders?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contactfolders/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/contactfolders/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contactFolders/{id}/contacts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contactFolders/{id}/contacts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/contactFolders/{id}/contacts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contacts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contacts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/contacts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/events/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events/{id}/attachments` | List attachments |
| GET | `/me/events/{id}/attachments/{id}` | Get attachment |
| GET | `/me/events/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/me/mailFolders?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/?includeHiddenFolders=true` | List mailFolders |
| GET | `/me/mailFolders/{id}` | Get mailFolder |
| GET | `/me/mailFolders/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/childFolders?includeHiddenFolders=true` | List childFolders |
| GET | `/me/mailFolders/{id}/childFolders/{id}/.../messages/{id}/attachments/{id}` | List attachments |
| GET | `/me/mailFolders/{id}/childFolders/{id}/.../messages/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/me/mailFolders/{id}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages/{id}` | Get message |
| GET | `/me/mailFolders/{id}/messages/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages/{id}/$value` | Get message |
| GET | `/me/mailFolders/{id}/messages/{id}/attachments` | List attachments |
| GET | `/me/mailFolders/{id}/messages/{id}/attachments/{id}` | Get attachment |
| GET | `/me/mailFolders/{id}/messages/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/me/mailFolders/{id}/messages/delta` | message: delta |
| GET | `/me/mailFolders/{id}/messages/delta?changeType=created` | message: delta |
| GET | `/me/mailFolders/{id}/messages/delta?changeType=deleted` | message: delta |
| GET | `/me/mailFolders/{id}/messages/delta?changeType=updated` | message: delta |
| GET | `/me/mailFolders/delta` | mailFolder: delta |
| GET | `/me/mailFolders/inbox/messageRules` | List rules |
| GET | `/me/mailFolders/inbox/messageRules/{id}` | Get rule |
| GET | `/me/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/messages/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages/{id}/$value` | Get message |
| GET | `/me/messages/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/me/outlook/masterCategories` | List masterCategories |
| GET | `/me/outlook/masterCategories/{id}` | Get Outlook category |
| GET | `/organization/{Id}?$expand=extensions($filter=id eq '{extensionId}')&$select=id,{property_1},{property_n}` | Get open extension |
| GET | `/organization/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}?$expand=extensions($filter=id eq '{extensionId}')&$select=id,{property_1},{property_n}` | Get open extension |
| GET | `/users/{id \| userPrincipalName}/calendar/events/{id}/attachments` | List attachments |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/attachments` | List attachments |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/attachments/{id}` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/users/{id\|userPrincipalName}/calendars?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/calendars/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/calendars/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/attachments` | List attachments |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/attachments/{id}` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/users/{id\|userPrincipalName}/contactFolders?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}/contacts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}/contacts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}/contacts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/contacts?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/contacts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/contacts/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/contacts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contacts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/contacts/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/events?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/events/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/events/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/events/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/events/{id}/attachments` | List attachments |
| GET | `/users/{id \| userPrincipalName}/events/{id}/attachments/{id}` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/events/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/users/{Id\|userPrincipalName}/events/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{id \| userPrincipalName}/mailFolders` | List mailFolders |
| GET | `/users/{id\|userPrincipalName}/mailFolders?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/mailFolders/?includeHiddenFolders=true` | List mailFolders |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}` | Get mailFolder |
| GET | `/users/{id\|userPrincipalName}/mailFolders/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/mailFolders/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/childFolders` | List childFolders |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/childFolders?includeHiddenFolders=true` | List childFolders |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/childFolders/{id}/messages/{id}/attachments/{id}` | List attachments |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/childFolders/{id}/messages/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}` | Get message |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/$value` | Get message |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/attachments` | List attachments |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/attachments/{id}` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/users/{id}/mailFolders/{id}/messages/delta` | message: delta |
| GET | `/users/{id}/mailfolders/{id}/messages/delta?changeType=created` | message: delta |
| GET | `/users/{id}/mailFolders/{id}/messages/delta?changeType=deleted` | message: delta |
| GET | `/users/{id}/mailFolders/{id}/messages/delta?changeType=updated` | message: delta |
| GET | `/users/{id}/mailFolders/delta` | mailFolder: delta |
| GET | `/users/{id \| userPrincipalName}/mailFolders/inbox/messageRules` | List rules |
| GET | `/users/{id \| userPrincipalName}/mailFolders/inbox/messageRules/{id}` | Get rule |
| GET | `/users/{Id\|userPrincipalName}/messages?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/messages/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/messages/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/messages/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/messages/{id}/$value` | Get message |
| GET | `/users/{id \| userPrincipalName}/messages/{id}/attachments` | List attachments |
| GET | `/users/{id \| userPrincipalName}/messages/{id}/attachments/{id}` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/messages/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/users/{Id\|userPrincipalName}/messages/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/outlook/masterCategories` | List masterCategories |
| GET | `/users/{id\|userPrincipalName}/outlook/masterCategories/{id}` | Get Outlook category |
| GET | `/users/{Id\|userPrincipalName}/todo/lists/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/todo/lists/{todoTaskListId}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{taskId}/extensions/{extensionId}` | Get open extension |
| PATCH | `/groups/{id}/events/{id}` | Create single-value extended property |
| PATCH | `/me/contactFolders/{id}` | Create single-value extended property |
| PATCH | `/me/inferenceClassification/overrides/{id}` | Update inferenceclassificationoverride |
| PATCH | `/me/mailFolders/{id}/messages/{id}` | Update message |
| PATCH | `/me/mailFolders/inbox/messageRules/{id}` | Update rule |
| PATCH | `/me/outlook/masterCategories/{id}` | Update outlookCategory |
| PATCH | `/users/{id\|userPrincipalName}/calendars/{id}` | Create single-value extended property |
| PATCH | `/users/{id\|userPrincipalName}/contactFolders/{id}` | Create single-value extended property |
| PATCH | `/users/{id\|userPrincipalName}/contacts/{id}` | Create single-value extended property |
| PATCH | `/users/{id\|userPrincipalName}/events/{id}` | Create single-value extended property |
| PATCH | `/users/{id}/inferenceClassification/overrides/{id}` | Update inferenceclassificationoverride |
| PATCH | `/users/{id\|userPrincipalName}/mailFolders/{id}` | Create single-value extended property |
| PATCH | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}` | Update message |
| PATCH | `/users/{id \| userPrincipalName}/mailFolders/inbox/messageRules/{id}` | Update rule |
| PATCH | `/users/{id \| userPrincipalName}/messages/{id}` | Update message |
| PATCH | `/users/{id\|userPrincipalName}/outlook/masterCategories/{id}` | Update outlookCategory |
| POST | `/devices/{id}/extensions` | Create open extension |
| POST | `/groups/{id}/conversations` | Create single-value extended property |
| POST | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/reply` | Create single-value extended property |
| POST | `/groups/{id}/conversations/{id}/threads/{id}/reply` | Create single-value extended property |
| POST | `/groups/{id}/events` | Create open extension |
| POST | `/groups/{id}/events/{id}/extensions` | Create open extension |
| POST | `/groups/{id}/extensions` | Create open extension |
| POST | `/groups/{id}/threads` | Create single-value extended property |
| POST | `/groups/{id}/threads/{id}/posts/{id}/extensions` | Create open extension |
| POST | `/groups/{id}/threads/{id}/posts/{id}/reply` | Create open extension |
| POST | `/me/calendar/events/{id}/attachments` | Add attachment |
| POST | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/attachments` | Add attachment |
| POST | `/me/calendars/{id}/events/{id}/attachments` | Add attachment |
| POST | `/me/contactFolders` | Create single-value extended property |
| POST | `/me/events/{id}/attachments` | Add attachment |
| POST | `/me/events/{id}/attachments/createUploadSession` | attachment: createUploadSession |
| POST | `/me/mailFolders/{id}/childFolders/{id}/.../messages/{id}/attachments/{id}` | Add attachment |
| POST | `/me/mailFolders/{id}/copy` | mailFolder: copy |
| POST | `/me/mailFolders/{id}/messages` | Create message |
| POST | `/me/mailFolders/{id}/messages/{id}/attachments` | Add attachment |
| POST | `/me/mailFolders/{id}/messages/{id}/copy` | message: copy |
| POST | `/me/mailFolders/{id}/messages/{id}/createForward` | message: createForward |
| POST | `/me/mailFolders/{id}/messages/{id}/createReply` | message: createReply |
| POST | `/me/mailFolders/{id}/messages/{id}/createReplyAll` | message: createReplyAll |
| POST | `/me/mailFolders/{id}/messages/{id}/forward` | message: forward |
| POST | `/me/mailFolders/{id}/messages/{id}/move` | message: move |
| POST | `/me/mailFolders/{id}/messages/{id}/reply` | message: reply |
| POST | `/me/mailFolders/{id}/messages/{id}/replyAll` | message: replyAll |
| POST | `/me/mailFolders/{id}/move` | mailFolder: move |
| POST | `/me/mailFolders/{id}/permanentDelete` | mailSearchFolder: permanentDelete |
| POST | `/me/mailFolders/inbox/messageRules` | Create rule |
| POST | `/me/messages/{id}/copy` | message: copy |
| POST | `/me/outlook/masterCategories` | Create Outlook category |
| POST | `/organization/{id}/extensions` | Create open extension |
| POST | `/users/{id \| userPrincipalName}/calendar/events/{id}/attachments` | Add attachment |
| POST | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/attachments` | Add attachment |
| POST | `/users/{id\|userPrincipalName}/calendars` | Create single-value extended property |
| POST | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/attachments` | Add attachment |
| POST | `/users/{id\|userPrincipalName}/contactFolders` | Create single-value extended property |
| POST | `/users/{id\|userPrincipalName}/contacts` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/contacts/{id}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/events` | Create open extension |
| POST | `/users/{id \| userPrincipalName}/events/{id}/attachments` | Add attachment |
| POST | `/users/{id \| userPrincipalName}/events/{id}/attachments/createUploadSession` | attachment: createUploadSession |
| POST | `/users/{id\|userPrincipalName}/events/{id}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/mailFolders` | Create single-value extended property |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/childFolders` | Create child folder |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/childFolders/{id}/messages/{id}/attachments/{id}` | Add attachment |
| POST | `/users/{usersId}/mailFolders/{mailFolderId}/childFolders/{mailFolderId}/permanentDelete` | mailFolder: permanentDelete |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/copy` | mailFolder: copy |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages` | Create message |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/attachments` | Add attachment |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/copy` | message: copy |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/createForward` | message: createForward |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/createReply` | message: createReply |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/createReplyAll` | message: createReplyAll |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/forward` | message: forward |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/move` | message: move |
| POST | `/users/{usersId}/mailFolders/{mailFolderId}/messages/{messageId}/permanentDelete` | message: permanentDelete |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/reply` | message: reply |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/replyAll` | message: replyAll |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/move` | mailFolder: move |
| POST | `/users/{usersId}/mailFolders/{mailFolderId}/permanentDelete` | mailFolder: permanentDelete |
| POST | `/users/{id \| userPrincipalName}/mailFolders/inbox/messageRules` | Create rule |
| POST | `/users/{id\|userPrincipalName}/messages` | Create message |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/attachments` | Add attachment |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/attachments/createUploadSession` | attachment: createUploadSession |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/copy` | message: copy |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/createForward` | message: createForward |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/createReply` | message: createReply |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/createReplyAll` | message: createReplyAll |
| POST | `/users/{id\|userPrincipalName}/messages/{id}/extensions` | Create open extension |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/forward` | message: forward |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/move` | message: move |
| POST | `/users/{usersId}/messages/{messageId}/permanentDelete` | message: permanentDelete |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/reply` | message: reply |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/replyAll` | message: replyAll |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/send` | message: send |
| POST | `/users/{id\|userPrincipalName}/outlook/masterCategories` | Create Outlook category |
| POST | `/users/{id\|userPrincipalName}/todo/lists` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/todo/lists/{id}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/todo/lists/{id}/tasks` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/todo/lists/{id}/tasks/{id}/extensions` | Create open extension |
| POST | `/users/me/messages/{id}/replyAll` | message: replyAll |

### Calendars — 460 missing of 503

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/groups/{id}/calendar/calendarPermissions/{id}` | Delete calendarPermission |
| DELETE | `/groups/{id}/calendar/events/{id}/` | Delete event |
| DELETE | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/groups/{id}/events/{id}` | Delete event |
| DELETE | `/groups/{id}/threads/{id}/posts/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/calendar/events/{id}` | Delete event |
| DELETE | `/me/calendar/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/calendarGroups/{id}` | Delete calendarGroup |
| DELETE | `/me/calendarGroups/{id}/calendars/{id}` | Delete calendar |
| DELETE | `/me/calendarGroups/{id}/calendars/{id}/events/{id}` | Delete event |
| DELETE | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/calendars/{id}/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/mailFolders/{id}/childFolders/{id}/.../messages/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/mailFolders/{id}/messages/{id}` | Delete message |
| DELETE | `/me/mailFolders/{id}/messages/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/me/outlook/masterCategories/{id}` | Delete outlookCategory |
| DELETE | `/me/settings/workHoursAndLocations/occurrences/{id}` | Delete workPlanOccurrence |
| DELETE | `/me/settings/workHoursAndLocations/recurrences/{id}` | Delete workPlanRecurrence |
| DELETE | `/places/{id}` | Delete place |
| DELETE | `/places/{buildingPlaceId}/microsoft.graph.building/map` | Delete buildingMap |
| DELETE | `/places/{buildingPlaceId}/microsoft.graph.building/map/levels/{levelImdfID}/fixtures/{fixturesImdfID}` | Delete fixtureMap |
| DELETE | `/places/{buildingPlaceId}/microsoft.graph.building/map/levels/{levelImdfID}/sections/{sectionImdfID}` | Delete sectionMap |
| DELETE | `/places/{buildingPlaceId}/microsoft.graph.building/map/levels/{levelImdfID}/units/{unitImdfID}` | Delete unitMap |
| DELETE | `/users/{id}/calendar/calendarPermissions/{id}` | Delete calendarPermission |
| DELETE | `/users/{id \| userPrincipalName}/calendar/events/{id}` | Delete event |
| DELETE | `/users/{id \| userPrincipalName}/calendar/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id \| userPrincipalName}/calendarGroups/{id}` | Delete calendarGroup |
| DELETE | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}` | Delete calendar |
| DELETE | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}` | Delete event |
| DELETE | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id \| userPrincipalName}/calendars/{id}` | Delete calendar |
| DELETE | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}` | Delete event |
| DELETE | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id \| userPrincipalName}/events/{id}` | Delete event |
| DELETE | `/users/{id \| userPrincipalName}/events/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id}/events/{id}/calendar/calendarPermissions/{id}` | Delete calendarPermission |
| DELETE | `/users/{id \| userPrincipalName}/mailFolders/{id}/childFolders/{id}/messages/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}` | Delete message |
| DELETE | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id \| userPrincipalName}/messages/{id}` | Delete message |
| DELETE | `/users/{id \| userPrincipalName}/messages/{id}/attachments/{id}` | Delete attachment |
| DELETE | `/users/{id\|userPrincipalName}/outlook/masterCategories/{id}` | Delete outlookCategory |
| DELETE | `/users/{id \| userPrincipalName}/settings/workHoursAndLocations/occurrences/{id}` | Delete workPlanOccurrence |
| DELETE | `/users/{id \| userPrincipalName}/settings/workHoursAndLocations/recurrences/{id}` | Delete workPlanRecurrence |
| GET | `/devices/{Id}?$expand=extensions($filter=id eq '{extensionId}')&$select=id,{property_1},{property_n}` | Get open extension |
| GET | `/devices/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/groups/{Id}?$expand=extensions($filter=id eq '{extensionId}')&$select=id,{property_1},{property_n}` | Get open extension |
| GET | `/groups/{id}/calendar` | Get calendar |
| GET | `/groups/{id}/calendar/calendarPermissions` | List calendarPermissions |
| GET | `/groups/{id}/calendar/calendarPermissions/{id}` | Get calendarPermission |
| GET | `/groups/{id}/calendar/events` | List events |
| GET | `/groups/{id}/calendar/events/{id}` | Get event |
| GET | `/groups/{id}/calendar/events/{id}/instances?startDateTime={start_datetime}&endDateTime={end_datetime}` | List instances |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/attachments` | List attachments |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/attachments/{id}` | Get attachment |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/groups/{Id}/events?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/groups/{id}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/events/{id}` | Get event |
| GET | `/groups/{Id}/events/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/groups/{id}/events/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/groups/{id}/events/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{Id}/events/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/groups/{id}/events/{id}/instances?startDateTime={start_datetime}&endDateTime={end_datetime}` | List instances |
| GET | `/groups/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/groups/{Id}/threads/{Id}/posts?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/groups/{id}/threads/{id}/posts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{Id}/threads/{Id}/posts/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/groups/{id}/threads/{id}/posts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/groups/{id}/threads/{id}/posts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/threads/{id}/posts/{id}/attachments` | List attachments |
| GET | `/groups/{id}/threads/{id}/posts/{id}/attachments/{id}` | Get attachment |
| GET | `/groups/{id}/threads/{id}/posts/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/groups/{Id}/threads/{Id}/posts/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/me/calendar` | Get calendar |
| GET | `/me/calendar/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List calendarView |
| GET | `/me/calendar/events` | List events |
| GET | `/me/calendar/events/{id}` | Get event |
| GET | `/me/calendar/events/{id}/attachments` | List attachments |
| GET | `/me/calendar/events/{id}/instances?startDateTime={start_datetime}&endDateTime={end_datetime}` | List instances |
| GET | `/me/calendarGroups` | List calendarGroups |
| GET | `/me/calendarGroups/{id}` | Get calendarGroup |
| GET | `/me/calendarGroups/{calendar_group_id}/calendars` | List calendars |
| GET | `/me/calendarGroups/{id}/calendars/{id}` | Get calendar |
| GET | `/me/calendarGroups/{id}/calendars/{id}/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List calendarView |
| GET | `/me/calendarGroups/{id}/calendars/{id}/events` | List events |
| GET | `/me/calendarGroups/{id}/calendars/{id}/events/{id}` | Get event |
| GET | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/attachments` | List attachments |
| GET | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/attachments/{id}` | Get attachment |
| GET | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/instances?startDateTime={start_datetime}&endDateTime={end_datetime}` | List instances |
| GET | `/me/calendars?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/calendars/{id}` | Get calendar |
| GET | `/me/calendars/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/calendars/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/calendars/{id}/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List calendarView |
| GET | `/me/calendars/{id}/events/{id}/attachments` | List attachments |
| GET | `/me/calendars/{id}/events/{id}/attachments/{id}` | Get attachment |
| GET | `/me/calendars/{id}/events/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/me/calendars/{id}/events/{id}/instances?startDateTime={start_datetime}&endDateTime={end_datetime}` | List instances |
| GET | `/me/calendarView/delta?startDateTime={start_datetime}&endDateTime={end_datetime}` | event: delta |
| GET | `/me/contactfolders?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contactfolders/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/contactfolders/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contactFolders/{id}/contacts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contactFolders/{id}/contacts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/contactFolders/{id}/contacts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contacts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contacts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/contacts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/events/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events/{id}/attachments` | List attachments |
| GET | `/me/events/{id}/attachments/{id}` | Get attachment |
| GET | `/me/events/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/me/events/{id}/instances?startDateTime={start_datetime}&endDateTime={end_datetime}` | List instances |
| GET | `/me/mailFolders?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/childFolders/{id}/.../messages/{id}/attachments/{id}` | Get attachment |
| GET | `/me/mailFolders/{id}/childFolders/{id}/.../messages/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/me/mailFolders/{id}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages/{id}` | Get eventMessage |
| GET | `/me/mailFolders/{id}/messages/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages/{id}/attachments` | List attachments |
| GET | `/me/mailFolders/{id}/messages/{id}/attachments/{id}` | Get attachment |
| GET | `/me/mailFolders/{id}/messages/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/me/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/messages/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/me/outlook/masterCategories` | List masterCategories |
| GET | `/me/outlook/masterCategories/{id}` | Get Outlook category |
| GET | `/me/settings/workHoursAndLocations` | Get workHoursAndLocationsSetting |
| GET | `/me/settings/workHoursAndLocations/occurrencesView(startDateTime='{startDateTime}',endDateTime='{endDateTime}')` | workHoursAndLocationsSetting: occurrencesView |
| GET | `/me/settings/workHoursAndLocations/recurrences` | List recurrences |
| GET | `/organization/{Id}?$expand=extensions($filter=id eq '{extensionId}')&$select=id,{property_1},{property_n}` | Get open extension |
| GET | `/organization/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/places/{placeType}` | List place objects |
| GET | `/places/{placesId}/checkIns/{calendarEventId}` | Get checkInClaim |
| GET | `/places/{id}/descendants/{placeType}` | place: descendants |
| GET | `/places/{buildingPlaceId}/microsoft.graph.building/map` | Get buildingMap |
| GET | `/places/{buildingPlaceId}/microsoft.graph.building/map/footprints` | List footprints |
| GET | `/places/{buildingPlaceId}/microsoft.graph.building/map/levels` | List levels |
| GET | `/places/{buildingPlaceId}/microsoft.graph.building/map/levels/{levelMapId}/fixtures` | List fixtures |
| GET | `/places/{buildingPlaceId}/microsoft.graph.building/map/levels/{levelMapId}/sections` | List sections |
| GET | `/places/{buildingPlaceId}/microsoft.graph.building/map/levels/{levelMapId}/units` | List units |
| GET | `/places/{room-list-emailaddress}/microsoft.graph.roomlist/rooms` | List place objects |
| GET | `/places/{room-list-emailaddress}/microsoft.graph.roomlist/workspaces` | List place objects |
| GET | `/users/{Id\|userPrincipalName}?$expand=extensions($filter=id eq '{extensionId}')&$select=id,{property_1},{property_n}` | Get open extension |
| GET | `/users/{id \| userPrincipalName}/calendar` | Get calendar |
| GET | `/users/{id}/calendar/calendarPermissions` | List calendarPermissions |
| GET | `/users/{id}/calendar/calendarPermissions/{id}` | Get calendarPermission |
| GET | `/users/{id \| userPrincipalName}/calendar/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List calendarView |
| GET | `/users/{id \| userPrincipalName}/calendar/events/{id}` | Get event |
| GET | `/users/{id \| userPrincipalName}/calendar/events/{id}/attachments` | List attachments |
| GET | `/users/{id \| userPrincipalName}/calendar/events/{id}/instances?startDateTime={start_datetime}&endDateTime={end_datetime}` | List instances |
| GET | `/users/{id \| userPrincipalName}/calendarGroups` | List calendarGroups |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}` | Get calendarGroup |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{calendar_group_id}/calendars` | List calendars |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}` | Get calendar |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List calendarView |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events` | List events |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}` | Get event |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/attachments` | List attachments |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/attachments/{id}` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/instances?startDateTime={start_datetime}&endDateTime={end_datetime}` | List instances |
| GET | `/users/{id \| userPrincipalName}/calendars` | List calendars |
| GET | `/users/{id\|userPrincipalName}/calendars?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}` | Get calendar |
| GET | `/users/{id\|userPrincipalName}/calendars/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/calendars/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List calendarView |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}/events` | List events |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}` | Get event |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/attachments` | List attachments |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/attachments/{id}` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/instances?startDateTime={start_datetime}&endDateTime={end_datetime}` | List instances |
| GET | `/users/{id}/calendarView/delta?startDateTime={start_datetime}&endDateTime={end_datetime}` | event: delta |
| GET | `/users/{id\|userPrincipalName}/contactFolders?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}/contacts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}/contacts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}/contacts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/contacts?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/contacts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/contacts/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/contacts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contacts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/contacts/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{id \| userPrincipalName}/events` | List events |
| GET | `/users/{Id\|userPrincipalName}/events?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/events/{id}` | Get event |
| GET | `/users/{Id\|userPrincipalName}/events/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/events/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/events/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/events/{id}/attachments` | List attachments |
| GET | `/users/{id \| userPrincipalName}/events/{id}/attachments/{id}` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/events/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/users/{id}/events/{id}/calendar/calendarPermissions` | List calendarPermissions |
| GET | `/users/{id}/events/{id}/calendar/calendarPermissions/{id}` | Get calendarPermission |
| GET | `/users/{Id\|userPrincipalName}/events/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{id \| userPrincipalName}/events/{id}/instances?startDateTime={start_datetime}&endDateTime={end_datetime}` | List instances |
| GET | `/users/{Id\|userPrincipalName}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/mailFolders?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/mailFolders/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/mailFolders/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/childFolders/{id}/messages/{id}/attachments/{id}` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/childFolders/{id}/messages/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}` | Get eventMessage |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/attachments` | List attachments |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/attachments/{id}` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/users/{Id\|userPrincipalName}/messages?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/messages/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/messages/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/messages/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/messages/{id}/attachments` | List attachments |
| GET | `/users/{id \| userPrincipalName}/messages/{id}/attachments/{id}` | Get attachment |
| GET | `/users/{id \| userPrincipalName}/messages/{id}/attachments/{id}/$value` | Get attachment |
| GET | `/users/{Id\|userPrincipalName}/messages/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/outlook/masterCategories` | List masterCategories |
| GET | `/users/{id\|userPrincipalName}/outlook/masterCategories/{id}` | Get Outlook category |
| GET | `/users/{id \| userPrincipalName}/settings/workHoursAndLocations` | Get workHoursAndLocationsSetting |
| GET | `/users/{id \| userPrincipalName}/settings/workHoursAndLocations/occurrencesView(startDateTime='{startDateTime}',endDateTime='{endDateTime}')` | workHoursAndLocationsSetting: occurrencesView |
| GET | `/users/{id \| userPrincipalName}/settings/workHoursAndLocations/recurrences` | List recurrences |
| GET | `/users/{Id\|userPrincipalName}/todo/lists/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/todo/lists/{todoTaskListId}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{taskId}/extensions/{extensionId}` | Get open extension |
| PATCH | `/groups/{id}/calendar` | Update calendar |
| PATCH | `/groups/{id}/calendar/calendarPermissions/{id}` | Update calendarpermission |
| PATCH | `/groups/{id}/calendar/events/{id}` | Update event |
| PATCH | `/groups/{id}/events/{id}` | Create single-value extended property |
| PATCH | `/me/calendar` | Update calendar |
| PATCH | `/me/calendar/events/{id}` | Update event |
| PATCH | `/me/calendarGroups/{id}` | Update calendargroup |
| PATCH | `/me/calendarGroups/{id}/calendars/{id}` | Update calendar |
| PATCH | `/me/calendarGroups/{id}/calendars/{id}/events/{id}` | Update event |
| PATCH | `/me/contactFolders/{id}` | Create single-value extended property |
| PATCH | `/me/mailFolders/{id}/messages/{id}` | Create single-value extended property |
| PATCH | `/me/outlook/masterCategories/{id}` | Update outlookCategory |
| PATCH | `/me/settings/workHoursAndLocations` | Update workHoursAndLocationsSetting |
| PATCH | `/places/{buildingPlaceId}/microsoft.graph.building/map/levels/{levelImdfId}/fixtures/{fixtureImdfId}` | Update fixtureMap |
| PATCH | `/places/{buildingPlaceId}/microsoft.graph.building/map/levels/{levelImdfID}/sections/{sectionImdfID}` | Update sectionMap |
| PATCH | `/places/{buildingPlaceId}/microsoft.graph.building/map/levels/{levelImdfID}/units/{unitImdfID}` | Update unitMap |
| PATCH | `/users/{id \| userPrincipalName}/calendar` | Update calendar |
| PATCH | `/users/{id}/calendar/calendarPermissions/{id}` | Update calendarpermission |
| PATCH | `/users/{id \| userPrincipalName}/calendar/events/{id}` | Update event |
| PATCH | `/users/{id \| userPrincipalName}/calendarGroups/{id}` | Update calendargroup |
| PATCH | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}` | Update calendar |
| PATCH | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}` | Update event |
| PATCH | `/users/{id \| userPrincipalName}/calendars/{id}` | Update calendar |
| PATCH | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}` | Update event |
| PATCH | `/users/{id\|userPrincipalName}/contactFolders/{id}` | Create single-value extended property |
| PATCH | `/users/{id\|userPrincipalName}/contacts/{id}` | Create single-value extended property |
| PATCH | `/users/{id\|userPrincipalName}/events/{id}` | Create single-value extended property |
| PATCH | `/users/{id}/events/{id}/calendar/calendarPermissions/{id}` | Update calendarpermission |
| PATCH | `/users/{id\|userPrincipalName}/mailFolders/{id}` | Create single-value extended property |
| PATCH | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}` | Update eventMessage |
| PATCH | `/users/{id\|userPrincipalName}/messages/{id}` | Create single-value extended property |
| PATCH | `/users/{id\|userPrincipalName}/outlook/masterCategories/{id}` | Update outlookCategory |
| PATCH | `/users/{id \| userPrincipalName}/settings/workHoursAndLocations` | Update workHoursAndLocationsSetting |
| POST | `/devices/{id}/extensions` | Create open extension |
| POST | `/groups/{id}/calendar/calendarPermissions` | Create calendarPermission |
| POST | `/groups/{id}/calendar/events` | Create event |
| POST | `/groups/{id}/calendar/events/{id}/cancel` | event: cancel |
| POST | `/groups/{id}/calendar/events/{id}/forward` | event: forward |
| POST | `/groups/{groupsId}/calendarView/{eventId}/permanentDelete` | event: permanentDelete |
| POST | `/groups/{id}/conversations` | Create single-value extended property |
| POST | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/reply` | Create single-value extended property |
| POST | `/groups/{id}/conversations/{id}/threads/{id}/reply` | Create single-value extended property |
| POST | `/groups/{id}/events` | Create single-value extended property |
| POST | `/groups/{id}/events/{id}/cancel` | event: cancel |
| POST | `/groups/{id}/events/{id}/extensions` | Create open extension |
| POST | `/groups/{id}/events/{id}/forward` | event: forward |
| POST | `/groups/{groupsId}/events/{eventId}/permanentDelete` | event: permanentDelete |
| POST | `/groups/{id}/extensions` | Create open extension |
| POST | `/groups/{id}/threads` | Create single-value extended property |
| POST | `/groups/{id}/threads/{id}/posts/{id}/extensions` | Create open extension |
| POST | `/groups/{id}/threads/{id}/posts/{id}/reply` | Create single-value extended property |
| POST | `/me/calendar/events` | Create event |
| POST | `/me/calendar/events/{id}/accept` | event: accept |
| POST | `/me/calendar/events/{id}/attachments` | Add attachment |
| POST | `/me/calendar/events/{id}/cancel` | event: cancel |
| POST | `/me/calendar/events/{id}/decline` | event: decline |
| POST | `/me/calendar/events/{id}/dismissReminder` | event: dismissReminder |
| POST | `/me/calendar/events/{id}/forward` | event: forward |
| POST | `/me/calendar/events/{id}/snoozeReminder` | event: snoozeReminder |
| POST | `/me/calendar/events/{id}/tentativelyAccept` | event: tentativelyAccept |
| POST | `/me/calendarGroups` | Create CalendarGroup |
| POST | `/me/calendarGroups/{id}/calendars` | Create Calendar |
| POST | `/me/calendarGroups/{id}/calendars/{id}/events` | Create event |
| POST | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/accept` | event: accept |
| POST | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/attachments` | Add attachment |
| POST | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/cancel` | event: cancel |
| POST | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/decline` | event: decline |
| POST | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/dismissReminder` | event: dismissReminder |
| POST | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/forward` | event: forward |
| POST | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/snoozeReminder` | event: snoozeReminder |
| POST | `/me/calendarGroups/{id}/calendars/{id}/events/{id}/tentativelyAccept` | event: tentativelyAccept |
| POST | `/me/calendars/{id}/events/{id}/accept` | event: accept |
| POST | `/me/calendars/{id}/events/{id}/attachments` | Add attachment |
| POST | `/me/calendars/{id}/events/{id}/cancel` | event: cancel |
| POST | `/me/calendars/{id}/events/{id}/decline` | event: decline |
| POST | `/me/calendars/{id}/events/{id}/dismissReminder` | event: dismissReminder |
| POST | `/me/calendars/{id}/events/{id}/forward` | event: forward |
| POST | `/me/calendars/{id}/events/{id}/snoozeReminder` | event: snoozeReminder |
| POST | `/me/calendars/{id}/events/{id}/tentativelyAccept` | event: tentativelyAccept |
| POST | `/me/contactFolders` | Create single-value extended property |
| POST | `/me/events/{id}/attachments` | Add attachment |
| POST | `/me/events/{id}/attachments/createUploadSession` | attachment: createUploadSession |
| POST | `/me/events/{id}/cancel` | event: cancel |
| POST | `/me/events/{id}/dismissReminder` | event: dismissReminder |
| POST | `/me/events/{id}/forward` | event: forward |
| POST | `/me/events/{id}/snoozeReminder` | event: snoozeReminder |
| POST | `/me/mailFolders/{id}/childFolders/{id}/.../messages/{id}/attachments/{id}` | Add attachment |
| POST | `/me/mailFolders/{id}/messages` | Create single-value extended property |
| POST | `/me/mailFolders/{id}/messages/{id}/attachments` | Add attachment |
| POST | `/me/mailFolders/{id}/messages/{id}/copy` | message: copy |
| POST | `/me/mailFolders/{id}/messages/{id}/createForward` | message: createForward |
| POST | `/me/mailFolders/{id}/messages/{id}/createReply` | message: createReply |
| POST | `/me/mailFolders/{id}/messages/{id}/createReplyAll` | message: createReplyAll |
| POST | `/me/mailFolders/{id}/messages/{id}/forward` | message: forward |
| POST | `/me/mailFolders/{id}/messages/{id}/move` | message: move |
| POST | `/me/mailFolders/{id}/messages/{id}/permanentDelete` | eventMessage: permanentDelete |
| POST | `/me/mailFolders/{id}/messages/{id}/reply` | message: reply |
| POST | `/me/mailFolders/{id}/messages/{id}/replyAll` | message: replyAll |
| POST | `/me/messages/{id}/copy` | message: copy |
| POST | `/me/messages/{id}/permanentDelete` | eventMessage: permanentDelete |
| POST | `/me/outlook/masterCategories` | Create Outlook category |
| POST | `/me/settings/workHoursAndLocations/occurrences` | Create workPlanOccurrence |
| POST | `/me/settings/workHoursAndLocations/occurrences/setCurrentLocation` | workPlanOccurrence: setCurrentLocation |
| POST | `/me/settings/workHoursAndLocations/recurrences` | Create workPlanRecurrence |
| POST | `/organization/{id}/extensions` | Create open extension |
| POST | `/places` | Create place |
| POST | `/places/{placesId}/checkIns` | Create checkInClaim |
| POST | `/places/{buildingPlaceId}/microsoft.graph.building/ingestMapFile` | building: ingestMapFile |
| POST | `/users/{id}/calendar/calendarPermissions` | Create calendarPermission |
| POST | `/users/{id \| userPrincipalName}/calendar/events` | Create event |
| POST | `/users/{id \| userPrincipalName}/calendar/events/{id}/accept` | event: accept |
| POST | `/users/{id \| userPrincipalName}/calendar/events/{id}/attachments` | Add attachment |
| POST | `/users/{id \| userPrincipalName}/calendar/events/{id}/cancel` | event: cancel |
| POST | `/users/{id \| userPrincipalName}/calendar/events/{id}/decline` | event: decline |
| POST | `/users/{id \| userPrincipalName}/calendar/events/{id}/dismissReminder` | event: dismissReminder |
| POST | `/users/{id \| userPrincipalName}/calendar/events/{id}/forward` | event: forward |
| POST | `/users/{id \| userPrincipalName}/calendar/events/{id}/snoozeReminder` | event: snoozeReminder |
| POST | `/users/{id \| userPrincipalName}/calendar/events/{id}/tentativelyAccept` | event: tentativelyAccept |
| POST | `/users/{id\|userPrincipalName}/calendar/getSchedule` | calendar: getSchedule |
| POST | `/users/{id \| userPrincipalName}/calendarGroups` | Create CalendarGroup |
| POST | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars` | Create Calendar |
| POST | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events` | Create event |
| POST | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/accept` | event: accept |
| POST | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/attachments` | Add attachment |
| POST | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/cancel` | event: cancel |
| POST | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/decline` | event: decline |
| POST | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/dismissReminder` | event: dismissReminder |
| POST | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/forward` | event: forward |
| POST | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/snoozeReminder` | event: snoozeReminder |
| POST | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events/{id}/tentativelyAccept` | event: tentativelyAccept |
| POST | `/users/{id \| userPrincipalName}/calendars` | Create calendar |
| POST | `/users/{id \| userPrincipalName}/calendars/{id}/events` | Create event |
| POST | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/accept` | event: accept |
| POST | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/attachments` | Add attachment |
| POST | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/cancel` | event: cancel |
| POST | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/decline` | event: decline |
| POST | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/dismissReminder` | event: dismissReminder |
| POST | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/forward` | event: forward |
| POST | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/snoozeReminder` | event: snoozeReminder |
| POST | `/users/{id \| userPrincipalName}/calendars/{id}/events/{id}/tentativelyAccept` | event: tentativelyAccept |
| POST | `/users/{usersId}/calendarView/{eventId}/permanentDelete` | event: permanentDelete |
| POST | `/users/{id\|userPrincipalName}/contactFolders` | Create single-value extended property |
| POST | `/users/{id\|userPrincipalName}/contacts` | Create single-value extended property |
| POST | `/users/{id\|userPrincipalName}/contacts/{id}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/events` | Create single-value extended property |
| POST | `/users/{id \| userPrincipalName}/events/{id}/accept` | event: accept |
| POST | `/users/{id \| userPrincipalName}/events/{id}/attachments` | Add attachment |
| POST | `/users/{id \| userPrincipalName}/events/{id}/attachments/createUploadSession` | attachment: createUploadSession |
| POST | `/users/{id}/events/{id}/calendar/calendarPermissions` | Create calendarPermission |
| POST | `/users/{id \| userPrincipalName}/events/{id}/cancel` | event: cancel |
| POST | `/users/{id \| userPrincipalName}/events/{id}/decline` | event: decline |
| POST | `/users/{id \| userPrincipalName}/events/{id}/dismissReminder` | event: dismissReminder |
| POST | `/users/{id\|userPrincipalName}/events/{id}/extensions` | Create open extension |
| POST | `/users/{id \| userPrincipalName}/events/{id}/forward` | event: forward |
| POST | `/users/{usersId}/events/{eventId}/permanentDelete` | event: permanentDelete |
| POST | `/users/{id \| userPrincipalName}/events/{id}/snoozeReminder` | event: snoozeReminder |
| POST | `/users/{id \| userPrincipalName}/events/{id}/tentativelyAccept` | event: tentativelyAccept |
| POST | `/users/{id\|userPrincipalName}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/findMeetingTimes` | user: findMeetingTimes |
| POST | `/users/{id\|userPrincipalName}/mailFolders` | Create single-value extended property |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/childFolders/{id}/messages/{id}/attachments/{id}` | Add attachment |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/attachments` | Add attachment |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/copy` | message: copy |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/createForward` | message: createForward |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/createReply` | message: createReply |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/createReplyAll` | message: createReplyAll |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/forward` | message: forward |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/move` | message: move |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/reply` | message: reply |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages/{id}/replyAll` | message: replyAll |
| POST | `/users/{id\|userPrincipalName}/messages` | Create single-value extended property |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/attachments` | Add attachment |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/attachments/createUploadSession` | attachment: createUploadSession |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/copy` | message: copy |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/createForward` | message: createForward |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/createReply` | message: createReply |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/createReplyAll` | message: createReplyAll |
| POST | `/users/{usersId}/messages/{messageId}/event/calendar/calendarView/{eventId}/permanentDelete` | event: permanentDelete |
| POST | `/users/{usersId}/messages/{messageId}/event/calendar/events/{eventId}/permanentDelete` | event: permanentDelete |
| POST | `/users/{usersId}/messages/{messageId}/event/exceptionOccurrences/{eventId}/permanentDelete` | event: permanentDelete |
| POST | `/users/{usersId}/messages/{messageId}/event/instances/{eventId}/permanentDelete` | event: permanentDelete |
| POST | `/users/{usersId}/messages/{messageId}/event/permanentDelete` | event: permanentDelete |
| POST | `/users/{id\|userPrincipalName}/messages/{id}/extensions` | Create open extension |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/forward` | message: forward |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/move` | message: move |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/reply` | message: reply |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/replyAll` | message: replyAll |
| POST | `/users/{id \| userPrincipalName}/messages/{id}/send` | message: send |
| POST | `/users/{id\|userPrincipalName}/outlook/masterCategories` | Create Outlook category |
| POST | `/users/{id \| userPrincipalName}/settings/workHoursAndLocations/occurrences` | Create workPlanOccurrence |
| POST | `/users/{id \| userPrincipalName}/settings/workHoursAndLocations/occurrences/setCurrentLocation` | workPlanOccurrence: setCurrentLocation |
| POST | `/users/{id \| userPrincipalName}/settings/workHoursAndLocations/recurrences` | Create workPlanRecurrence |
| POST | `/users/{id\|userPrincipalName}/todo/lists` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/todo/lists/{id}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/todo/lists/{id}/tasks` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/todo/lists/{id}/tasks/{id}/extensions` | Create open extension |
| POST | `/users/me/messages/{id}/replyAll` | message: replyAll |
| PUT | `/me/settings/workHoursAndLocations/occurrences/{id}` | Update workPlanOccurrence |
| PUT | `/me/settings/workHoursAndLocations/recurrences/{id}` | Update workPlanRecurrence |
| PUT | `/users/{id \| userPrincipalName}/settings/workHoursAndLocations/occurrences/{id}` | Update workPlanOccurrence |
| PUT | `/users/{id \| userPrincipalName}/settings/workHoursAndLocations/recurrences/{id}` | Update workPlanRecurrence |

### Files / OneDrive — 259 missing of 273

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/drive/bundles/{bundle-id}/children/{item-id}` | Remove item from bundle |
| DELETE | `/drive/items/{bundle-id}` | Delete bundle |
| DELETE | `/drives/{drive-id}/items/{item-id}/retentionLabel` | driveItem: removeRetentionLabel |
| DELETE | `/groups/{group-id}/drive/items/{item-id}` | Delete a file or folder |
| DELETE | `/groups/{group-id}/drive/items/{item-id}/permissions/{perm-id}` | Remove access to an item |
| DELETE | `/me/drive/following/{item-id}` | Unfollow drive item |
| DELETE | `/me/drive/items/{item-id}` | Delete a file or folder |
| DELETE | `/me/drive/items/{item-id}/permissions/{perm-id}` | Remove access to an item |
| DELETE | `/sites/{siteId}/drive/items/{itemId}` | Delete a file or folder |
| DELETE | `/sites/{site-id}/drive/items/{item-id}/permissions/{perm-id}` | Remove access to an item |
| DELETE | `/storage/fileStorage/containers/{containerId}` | Delete fileStorageContainer |
| DELETE | `/storage/fileStorage/containers/{containerId}/columns/{columnId}` | Delete column |
| DELETE | `/storage/fileStorage/containers/{fileStorageContainerId}/migrationJobs/{sharePointMigrationJobId}` | Delete sharePointMigrationJob |
| DELETE | `/storage/fileStorage/containers/{containerId}/permissions/{permissionId}` | Delete permissions |
| DELETE | `/storage/fileStorage/containerTypeRegistrations/{fileStorageContainerTypeRegistrationId}` | Delete fileStorageContainerTypeRegistration |
| DELETE | `/storage/fileStorage/containerTypeRegistrations/{fileStorageContainerTypeRegistrationId}/applicationPermissionGrants/{appId}` | Delete fileStorageContainerTypeAppPermissionGrant |
| DELETE | `/storage/fileStorage/containerTypes/{fileStorageContainerTypeId}` | Delete fileStorageContainerType |
| DELETE | `/storage/fileStorage/deletedContainers/{containerId}` | Remove deleted fileStorageContainer |
| DELETE | `/users/{user-id}/drive/following/{item-id}` | Unfollow drive item |
| DELETE | `/users/{userId}/drive/items/{itemId}` | Delete a file or folder |
| DELETE | `/users/{user-id}/drive/items/{item-id}/permissions/{perm-id}` | Remove access to an item |
| GET | `/drive/bundles` | List bundles |
| GET | `/drive/bundles/{bundle-id}` | Get bundle |
| GET | `/drive/items/{bundle-id}` | Get bundle |
| GET | `/drive/items/{item-id}/content?format={format}` | Convert to other formats |
| GET | `/drive/root:/{path and filename}:/content?format={format}` | Convert to other formats |
| GET | `/drives/{driveId}` | Get drive |
| GET | `/drives/{drive-id}/activities` | List activities |
| GET | `/drives/{drive-id}/items/{item-id}?$expand=retentionLabel` | driveItem: getRetentionLabel |
| GET | `/drives/{drive-id}/items/{item-id}/activities` | List activities |
| GET | `/drives/{drive-id}/items/{item-id}/analytics/allTime` | Get itemAnalytics |
| GET | `/drives/{drive-id}/items/{item-id}/analytics/lastSevenDays` | Get itemAnalytics |
| GET | `/drives/{drive-id}/items/{item-id}/getActivitiesByInterval(startDateTime={startDateTime},endDateTime={endDateTime},interval={interval})` | Get item activity stats by interval |
| GET | `/drives/{drive-id}/items/{item-id}/permissions/{perm-id}` | Get permission |
| GET | `/drives/{drive-id}/items/{item-id}/retentionLabel` | driveItem: getRetentionLabel |
| GET | `/drives/{drive-id}/items/{item-id}/thumbnails` | Retrieve thumbnails for a file or folder |
| GET | `/drives/{drive-id}/items/{item-id}/versions/{version-id}` | Get driveItemVersion |
| GET | `/drives/{drive-id}/items/{item-id}/versions/{version-id}/content` | Download contents of a driveItemVersion resource |
| GET | `/drives/{driveId}/list/subscriptions/socketIo` | Get websocket endpoint |
| GET | `/drives/{drive-id}/root:/{item-path}` | Get driveItem |
| GET | `/drives/{drive-id}/root/delta` | driveItem: delta |
| GET | `/drives/{drive-id}/root/search(q='{search-text}')` | Search for files |
| GET | `/drives/{driveId}/root/subscriptions/socketIo` | Get websocket endpoint |
| GET | `/groups/{groupId}/drive` | Get drive |
| GET | `/groups/{group-id}/drive/items/{item-id}` | Get driveItem |
| GET | `/groups/{group-id}/drive/items/{item-id}/children` | List the contents of a folder |
| GET | `/groups/{group-id}/drive/items/{item-id}/content` | Download driveItem content |
| GET | `/groups/{group-id}/drive/items/{item-id}/permissions` | List who has access to a file |
| GET | `/groups/{group-id}/drive/items/{item-id}/permissions/{perm-id}` | Get permission |
| GET | `/groups/{group-id}/drive/items/{item-id}/thumbnails` | Retrieve thumbnails for a file or folder |
| GET | `/groups/{group-id}/drive/items/{item-id}/versions` | List versions |
| GET | `/groups/{group-id}/drive/items/{item-id}/versions/{version-id}` | Get driveItemVersion |
| GET | `/groups/{group-id}/drive/items/{item-id}/versions/{version-id}/content` | Download contents of a driveItemVersion resource |
| GET | `/groups/{group-id}/drive/root:/{item-path}` | Get driveItem |
| GET | `/groups/{groupId}/drive/root/delta` | driveItem: delta |
| GET | `/groups/{group-id}/drive/root/search(q='{search-text}')` | Search for files |
| GET | `/groups/{groupId}/drive/root/subscriptions/socketIo` | Get websocket endpoint |
| GET | `/groups/{groupId}/drives` | List Drives |
| GET | `/me/drive` | Get drive |
| GET | `/me/drive/following` | List followed items |
| GET | `/me/drive/items/{item-id}` | Get driveItem |
| GET | `/me/drive/items/{item-id}/children` | List the contents of a folder |
| GET | `/me/drive/items/{item-id}/content` | Download driveItem content |
| GET | `/me/drive/items/{item-id}/permissions` | List who has access to a file |
| GET | `/me/drive/items/{item-id}/permissions/{perm-id}` | Get permission |
| GET | `/me/drive/items/{item-id}/thumbnails` | Retrieve thumbnails for a file or folder |
| GET | `/me/drive/items/{item-id}/versions` | List versions |
| GET | `/me/drive/items/{item-id}/versions/{version-id}` | Get driveItemVersion |
| GET | `/me/drive/items/{item-id}/versions/{version-id}/content` | Download contents of a driveItemVersion resource |
| GET | `/me/drive/recent` | drive: recent (deprecated) |
| GET | `/me/drive/root:/{item-path}` | Get driveItem |
| GET | `/me/drive/root:/{item-path}:/content` | Download driveItem content |
| GET | `/me/drive/root:/{path}:/permissions` | List who has access to a file |
| GET | `/me/drive/root/delta` | driveItem: delta |
| GET | `/me/drive/root/search(q='{search-text}')` | Search for files |
| GET | `/me/drive/root/subscriptions/socketIo` | Get websocket endpoint |
| GET | `/me/drive/sharedWithMe` | drive: sharedWithMe (deprecated) |
| GET | `/me/drive/special/{name}` | Get Special Folders |
| GET | `/shares/{shareIdOrEncodedSharingUrl}` | Access shared items |
| GET | `/shares/{shareIdOrEncodedSharingUrl}/driveItem/content` | Download driveItem content |
| GET | `/sites/{site-id}/analytics/allTime` | Get itemAnalytics |
| GET | `/sites/{site-id}/analytics/lastSevenDays` | Get itemAnalytics |
| GET | `/sites/{siteId}/drive` | Get drive |
| GET | `/sites/{site-id}/drive/items/{item-id}` | Get driveItem |
| GET | `/sites/{site-id}/drive/items/{item-id}/children` | List the contents of a folder |
| GET | `/sites/{siteId}/drive/items/{item-id}/content` | Download driveItem content |
| GET | `/sites/{siteId}/drive/items/{itemId}/permissions` | List who has access to a file |
| GET | `/sites/{site-id}/drive/items/{item-id}/permissions/{perm-id}` | Get permission |
| GET | `/sites/{site-id}/drive/items/{item-id}/thumbnails` | Retrieve thumbnails for a file or folder |
| GET | `/sites/{site-id}/drive/items/{item-id}/versions` | List versions |
| GET | `/sites/{site-id}/drive/items/{item-id}/versions/{version-id}` | Get driveItemVersion |
| GET | `/sites/{site-id}/drive/items/{item-id}/versions/{version-id}/content` | Download contents of a driveItemVersion resource |
| GET | `/sites/{site-id}/drive/root:/{item-path}` | Get driveItem |
| GET | `/sites/{siteId}/drive/root/delta` | driveItem: delta |
| GET | `/sites/{site-id}/drive/root/search(q='{search-text}')` | Search for files |
| GET | `/sites/{site-id}/getActivitiesByInterval(startDateTime={startDateTime},endDateTime={endDateTime},interval={interval})` | Get item activity stats by interval |
| GET | `/sites/{site-id}/lists/{list-id}/activities` | List activities |
| GET | `/sites/{siteId}/lists/{listId}/drive/root/subscriptions/socketIo` | Get websocket endpoint |
| GET | `/sites/{site-id}/lists/{list-id}/items/{item-id}/activities` | List activities |
| GET | `/sites/{site-id}/lists/{list-id}/items/{item-id}/analytics/allTime` | Get itemAnalytics |
| GET | `/sites/{site-id}/lists/{list-id}/items/{item-id}/analytics/lastSevenDays` | Get itemAnalytics |
| GET | `/sites/{site-id}/lists/{list-id}/items/{item-id}/driveItem` | Get driveItem |
| GET | `/sites/{site-id}/lists/{list-id}/items/{item-id}/getActivitiesByInterval(startDateTime={startDateTime},endDateTime={endDateTime},interval={interval})` | Get item activity stats by interval |
| GET | `/storage/fileStorage/containers/{containerId}` | Get fileStorageContainer |
| GET | `/storage/fileStorage/containers/{containerId}/columns` | List columns in fileStorageContainer |
| GET | `/storage/fileStorage/containers/{containerId}/columns/{columnId}` | Get column |
| GET | `/storage/fileStorage/containers/{containerId}/customProperties` | List fileStorageContainer custom properties |
| GET | `/storage/fileStorage/containers/{containerId}/customProperties/{propertyName}` | List fileStorageContainer custom properties |
| GET | `/storage/fileStorage/containers/{containerId}/drive` | Get drive for fileStorageContainer |
| GET | `/storage/fileStorage/containers/{fileStorageContainerId}/migrationJobs/{migrationJobId}/progressEvents` | List progressEvents |
| GET | `/storage/fileStorage/containers/{containerId}/permissions` | List fileStorageContainer permissions |
| GET | `/storage/fileStorage/containers/{containerId}/recycleBin/items` | List recycleBinItem |
| GET | `/storage/fileStorage/containerTypeRegistrations` | List containerTypeRegistrations |
| GET | `/storage/fileStorage/containerTypeRegistrations/{fileStorageContainerTypeRegistrationId}` | Get fileStorageContainerTypeRegistration |
| GET | `/storage/fileStorage/containerTypeRegistrations/{fileStorageContainerTypeRegistrationId}/applicationPermissionGrants` | List applicationPermissionGrants |
| GET | `/storage/fileStorage/containerTypeRegistrations/{fileStorageContainerTypeRegistrationId}/applicationPermissionGrants/{appId}` | Get fileStorageContainerTypeAppPermissionGrant |
| GET | `/storage/fileStorage/containerTypes` | List containerTypes |
| GET | `/storage/fileStorage/containerTypes/{fileStorageContainerTypeId}` | Get fileStorageContainerType |
| GET | `/users/{user-id \| userPrincipalName}/drive/items/{item-id}` | Get driveItem |
| GET | `/users/{user-id \| userPrincipalName}/drive/items/{item-id}/children` | List the contents of a folder |
| GET | `/users/{userId}/drive/items/{item-id}/content` | Download driveItem content |
| GET | `/users/{userId}/drive/items/{itemId}/permissions` | List who has access to a file |
| GET | `/users/{user-id}/drive/items/{item-id}/permissions/{perm-id}` | Get permission |
| GET | `/users/{user-id}/drive/items/{item-id}/thumbnails` | Retrieve thumbnails for a file or folder |
| GET | `/users/{user-id}/drive/items/{item-id}/versions` | List versions |
| GET | `/users/{user-id}/drive/items/{item-id}/versions/{version-id}` | Get driveItemVersion |
| GET | `/users/{user-id}/drive/items/{item-id}/versions/{version-id}/content` | Download contents of a driveItemVersion resource |
| GET | `/users/{user-id \| userPrincipalName}/drive/root:/{item-path}` | Get driveItem |
| GET | `/users/{userId \| userPrincipalName}/drive/root/delta` | driveItem: delta |
| GET | `/users/{user-id \| userPrincipalName}/drive/root/search(q='{search-text}')` | Search for files |
| GET | `/users/{userId}/drives` | List Drives |
| PATCH | `/drive/items/{bundle-id}` | Update bundle |
| PATCH | `/drives/{drive-id}/items/{item-id}/permissions/{perm-id}` | Change sharing permissions |
| PATCH | `/drives/{drive-id}/items/{item-id}/retentionLabel` | driveItem: setRetentionLabel |
| PATCH | `/groups/{group-id}/drive/items/{item-id}` | Update a file or folder |
| PATCH | `/groups/{group-id}/drive/items/{item-id}/permissions/{perm-id}` | Change sharing permissions |
| PATCH | `/me/drive/items/{item-id}` | Update a file or folder |
| PATCH | `/me/drive/items/{item-id}/permissions/{perm-id}` | Change sharing permissions |
| PATCH | `/sites/{site-id}/drive/items/{item-id}` | Update a file or folder |
| PATCH | `/sites/{site-id}/drive/items/{item-id}/permissions/{perm-id}` | Change sharing permissions |
| PATCH | `/storage/fileStorage/containers/{containerId}` | Update fileStorageContainer |
| PATCH | `/storage/fileStorage/containers/{containerId}/columns/{columnId}` | Update column |
| PATCH | `/storage/fileStorage/containers/{containerId}/customProperties` | Add custom properties to a fileStorageContainer |
| PATCH | `/storage/fileStorage/containers/{containerId}/permissions/{permissionId}` | Update fileStoreContainer permission |
| PATCH | `/storage/fileStorage/containers/{containerId}/recycleBin/settings` | Update recycleBinSettings |
| PATCH | `/storage/fileStorage/containerTypeRegistrations/{fileStorageContainerTypeRegistrationId}` | Update fileStorageContainerTypeRegistration |
| PATCH | `/storage/fileStorage/containerTypeRegistrations/{fileStorageContainerTypeRegistrationId}/applicationPermissionGrants/{appId}` | Update fileStorageContainerTypeAppPermissionGrant |
| PATCH | `/storage/fileStorage/containerTypes/{fileStorageContainerTypeId}` | Update fileStorageContainerType |
| PATCH | `/users/{user-id}/drive/items/{item-id}` | Update a file or folder |
| PATCH | `/users/{user-id}/drive/items/{item-id}/permissions/{perm-id}` | Change sharing permissions |
| POST | `/drive/bundles` | Create bundle |
| POST | `/drive/bundles/{bundle-id}/children` | Add item to a bundle |
| POST | `/drives/{driveId}/items/{parentItemId}:/{fileName}:/createUploadSession` | driveItem: createUploadSession |
| POST | `/drives/{drive-id}/items/{item-id}/assignSensitivityLabel` | driveItem: assignSensitivityLabel |
| POST | `/drives/{driveId}/items/{itemId}/checkin` | driveItem: checkin |
| POST | `/drives/{driveId}/items/{itemId}/checkout` | driveItem: checkout |
| POST | `/drives/{driveId}/items/{itemId}/copy` | driveItem: copy |
| POST | `/drives/{driveId}/items/{itemId}/createLink` | Share a file with a link |
| POST | `/drives/{driveId}/items/{itemId}/discardCheckout` | driveItem: discardCheckout |
| POST | `/drives/{drive-id}/items/{item-id}/extractSensitivityLabels` | driveItem: extractSensitivityLabels |
| POST | `/drives/{drive-id}/items/{item-id}/follow` | Follow drive item |
| POST | `/drives/{drive-id}/items/{item-id}/permanentDelete` | Permanently delete a file or folder |
| POST | `/drives/{driveId}/items/{itemId}/preview` | driveItem: preview |
| POST | `/drives/{driveId}/items/{itemId}/versions/{version-id}/restoreVersion` | driveItemVersion: restoreVersion |
| POST | `/drives/{drive-id}/root:/{item-path}:/assignSensitivityLabel` | driveItem: assignSensitivityLabel |
| POST | `/drives/{drive-id}/root:/{item-path}:/extractSensitivityLabels` | driveItem: extractSensitivityLabels |
| POST | `/groups/{groupId}/drive/items/{parentItemId}:/{fileName}:/createUploadSession` | driveItem: createUploadSession |
| POST | `/groups/{group-id}/drive/items/{item-id}/assignSensitivityLabel` | driveItem: assignSensitivityLabel |
| POST | `/groups/{groupId}/drive/items/{itemId}/checkin` | driveItem: checkin |
| POST | `/groups/{groupId}/drive/items/{itemId}/checkout` | driveItem: checkout |
| POST | `/groups/{group-id}/drive/items/{parent-item-id}/children` | Create a new folder |
| POST | `/groups/{groupId}/drive/items/{itemId}/copy` | driveItem: copy |
| POST | `/groups/{groupId}/drive/items/{itemId}/createLink` | Share a file with a link |
| POST | `/groups/{groupId}/drive/items/{itemId}/createUploadSession` | driveItem: createUploadSession |
| POST | `/groups/{groupId}/drive/items/{itemId}/discardCheckout` | driveItem: discardCheckout |
| POST | `/groups/{group-id}/drive/items/{item-id}/extractSensitivityLabels` | driveItem: extractSensitivityLabels |
| POST | `/groups/{group-id}/drive/items/{item-id}/follow` | Follow drive item |
| POST | `/groups/{group-id}/drive/items/{item-id}/invite` | driveItem: invite |
| POST | `/groups/{groupId}/drive/items/{itemId}/preview` | driveItem: preview |
| POST | `/groups/{groupId}/drive/items/{itemId}/versions/{version-id}/restoreVersion` | driveItemVersion: restoreVersion |
| POST | `/groups/{group-id}/drive/root:/{item-path}:/assignSensitivityLabel` | driveItem: assignSensitivityLabel |
| POST | `/groups/{group-id}/drive/root:/{item-path}:/extractSensitivityLabels` | driveItem: extractSensitivityLabels |
| POST | `/me/drive/items/{parentItemId}:/{fileName}:/createUploadSession` | driveItem: createUploadSession |
| POST | `/me/drive/items/{item-id}/assignSensitivityLabel` | driveItem: assignSensitivityLabel |
| POST | `/me/drive/items/{item-id}/checkin` | driveItem: checkin |
| POST | `/me/drive/items/{item-id}/checkout` | driveItem: checkout |
| POST | `/me/drive/items/{parent-item-id}/children` | Create a new folder |
| POST | `/me/drive/items/{item-id}/copy` | driveItem: copy |
| POST | `/me/drive/items/{itemId}/createLink` | Share a file with a link |
| POST | `/me/drive/items/{itemId}/createUploadSession` | driveItem: createUploadSession |
| POST | `/me/drive/items/{item-id}/discardCheckout` | driveItem: discardCheckout |
| POST | `/me/drive/items/{item-id}/extractSensitivityLabels` | driveItem: extractSensitivityLabels |
| POST | `/me/drive/items/{item-id}/follow` | Follow drive item |
| POST | `/me/drive/items/{item-id}/invite` | driveItem: invite |
| POST | `/me/drive/items/{itemId}/preview` | driveItem: preview |
| POST | `/me/drive/items/{item-id}/restore` | driveItem: restore |
| POST | `/me/drive/items/{item-id}/unfollow` | Unfollow drive item |
| POST | `/me/drive/items/{item-id}/versions/{version-id}/restoreVersion` | driveItemVersion: restoreVersion |
| POST | `/me/drive/root:/{item-path}:/assignSensitivityLabel` | driveItem: assignSensitivityLabel |
| POST | `/me/drive/root:/{item-path}:/extractSensitivityLabels` | driveItem: extractSensitivityLabels |
| POST | `/shares/{shareId}/driveItem/preview` | driveItem: preview |
| POST | `/shares/{encoded-sharing-url}/permission/grant` | Grant permission |
| POST | `/sites/{siteId}/drive/items/{parentItemId}:/{fileName}:/createUploadSession` | driveItem: createUploadSession |
| POST | `/sites/{site-id}/drive/items/{item-id}/assignSensitivityLabel` | driveItem: assignSensitivityLabel |
| POST | `/sites/{siteId}/drive/items/{itemId}/checkin` | driveItem: checkin |
| POST | `/sites/{siteId}/drive/items/{itemId}/checkout` | driveItem: checkout |
| POST | `/sites/{site-id}/drive/items/{parent-item-id}/children` | Create a new folder |
| POST | `/sites/{siteId}/drive/items/{itemId}/copy` | driveItem: copy |
| POST | `/sites/{siteId}/drive/items/{itemId}/createLink` | Share a file with a link |
| POST | `/sites/{siteId}/drive/items/{itemId}/createUploadSession` | driveItem: createUploadSession |
| POST | `/sites/{siteId}/drive/items/{itemId}/discardCheckout` | driveItem: discardCheckout |
| POST | `/sites/{site-id}/drive/items/{item-id}/extractSensitivityLabels` | driveItem: extractSensitivityLabels |
| POST | `/sites/{site-id}/drive/items/{item-id}/follow` | Follow drive item |
| POST | `/sites/{siteId}/drive/items/{itemId}/invite` | driveItem: invite |
| POST | `/sites/{siteId}/drive/items/{itemId}/preview` | driveItem: preview |
| POST | `/sites/{siteId}/drive/items/{itemId}/versions/{version-id}/restoreVersion` | driveItemVersion: restoreVersion |
| POST | `/sites/{site-id}/drive/root:/{item-path}:/assignSensitivityLabel` | driveItem: assignSensitivityLabel |
| POST | `/sites/{site-id}/drive/root:/{item-path}:/extractSensitivityLabels` | driveItem: extractSensitivityLabels |
| POST | `/storage/fileStorage/containers` | Create fileStorageContainer |
| POST | `/storage/fileStorage/containers/{containerId}/activate` | fileStorageContainer: activate |
| POST | `/storage/fileStorage/containers/{containerId}/columns` | Create column |
| POST | `/storage/fileStorage/containers/{containerId}/lock` | fileStorageContainer: lock |
| POST | `/storage/fileStorage/containers/{fileStorageContainerId}/migrationJobs` | Create sharePointMigrationJob |
| POST | `/storage/fileStorage/containers/{containerId}/permanentDelete` | fileStorageContainer: permanentDelete |
| POST | `/storage/fileStorage/containers/{containerId}/permissions` | Create fileStorageContainer permission |
| POST | `/storage/fileStorage/containers/{fileStorageContainerId}/provisionMigrationContainers` | fileStorageContainer: provisionMigrationContainers |
| POST | `/storage/fileStorage/containers/{containerId}/recycleBin/items/delete` | Delete recycleBinItem |
| POST | `/storage/fileStorage/containers/{containerId}/recycleBin/items/restore` | Restore recycleBinItem |
| POST | `/storage/fileStorage/containers/{containerId}/unlock` | fileStorageContainer: unlock |
| POST | `/storage/fileStorage/containerTypes` | Create fileStorageContainerType |
| POST | `/storage/fileStorage/deletedContainers/{containerId}/restore` | fileStorageContainer: restore |
| POST | `/users/{userId}/drive/items/{parentItemId}:/{fileName}:/createUploadSession` | driveItem: createUploadSession |
| POST | `/users/{user-id}/drive/items/{item-id}/assignSensitivityLabel` | driveItem: assignSensitivityLabel |
| POST | `/users/{userId}/drive/items/{itemId}/checkin` | driveItem: checkin |
| POST | `/users/{userId}/drive/items/{itemId}/checkout` | driveItem: checkout |
| POST | `/users/{user-id}/drive/items/{parent-item-id}/children` | Create a new folder |
| POST | `/users/{userId}/drive/items/{itemId}/copy` | driveItem: copy |
| POST | `/users/{userId}/drive/items/{itemId}/createLink` | Share a file with a link |
| POST | `/users/{userId}/drive/items/{itemId}/createUploadSession` | driveItem: createUploadSession |
| POST | `/users/{userId}/drive/items/{itemId}/discardCheckout` | driveItem: discardCheckout |
| POST | `/users/{user-id}/drive/items/{item-id}/extractSensitivityLabels` | driveItem: extractSensitivityLabels |
| POST | `/users/{user-id}/drive/items/{item-id}/follow` | Follow drive item |
| POST | `/users/{userId}/drive/items/{itemId}/invite` | driveItem: invite |
| POST | `/users/{userId}/drive/items/{itemId}/preview` | driveItem: preview |
| POST | `/users/{user-id}/drive/items/{item-id}/unfollow` | Unfollow drive item |
| POST | `/users/{userId}/drive/items/{itemId}/versions/{version-id}/restoreVersion` | driveItemVersion: restoreVersion |
| POST | `/users/{user-id}/drive/root:/{item-path}:/assignSensitivityLabel` | driveItem: assignSensitivityLabel |
| POST | `/users/{user-id}/drive/root:/{item-path}:/extractSensitivityLabels` | driveItem: extractSensitivityLabels |
| PUT | `/drives/{drive-id}/items/{parent-id}:/{filename}:/content` | Upload small files |
| PUT | `/groups/{group-id}/drive/items/{parent-id}:/{filename}:/content` | Upload small files |
| PUT | `/groups/{group-id}/drive/items/{item-id}/content` | Upload small files |
| PUT | `/me/drive/items/{parent-id}:/{filename}:/content` | Upload small files |
| PUT | `/me/drive/items/{item-id}/content` | Upload small files |
| PUT | `/sites/{site-id}/drive/items/{parent-id}:/{filename}:/content` | Upload small files |
| PUT | `/sites/{site-id}/drive/items/{item-id}/content` | Upload small files |
| PUT | `/storage/fileStorage/containerTypeRegistrations/{fileStorageContainerTypeId}` | Create fileStorageContainerTypeRegistration |
| PUT | `/storage/fileStorage/containerTypeRegistrations/{fileStorageContainerTypeRegistrationId}/applicationPermissionGrants/{appId}` | Create fileStorageContainerTypeAppPermissionGrant |
| PUT | `/users/{user-id}/drive/items/{parent-id}:/{filename}:/content` | Upload small files |
| PUT | `/users/{user-id}/drive/items/{item-id}/content` | Upload small files |

### Teams & Communications — 407 missing of 456

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/app/calls/{id}/audioRoutingGroups/{id}` | Delete audioRoutingGroup |
| DELETE | `/appCatalogs/teamsApps/{id}` | Delete teamsApp |
| DELETE | `appCatalogs/teamsApps/{appId}/appDefinitions/{appDefinitionId}` | Delete teamsApp |
| DELETE | `/chats/{chat-id}` | Delete chat |
| DELETE | `/chats/{chat-id}/installedApps/{app-installation-id}` | Uninstall app in a chat |
| DELETE | `/chats/{chat-id}/members/{membership-id}` | Remove member from chat |
| DELETE | `/chats/{chat-id}/tabs/{tab-id}` | Delete tab from chat |
| DELETE | `/communications/calls/{id}` | Delete call |
| DELETE | `/communications/calls/{id}/audioRoutingGroups/{id}` | Delete audioRoutingGroup |
| DELETE | `/communications/calls/{id}/participants/{id}` | Delete participant |
| DELETE | `/employeeExperience/learningProviders/{learningProviderId}/$ref` | Delete learningProvider |
| DELETE | `/employeeExperience/learningProviders/{learningProviderId}/learningContents(externalId='{externalId}')/$ref` | Delete learningContent |
| DELETE | `/employeeExperience/learningProviders/{learningProviderId}/learningContents/{learningContentId}/$ref` | Delete learningContent |
| DELETE | `/employeeExperience/learningProviders/{registrationId}/learningCourseActivities/{id}` | Delete learningCourseActivity |
| DELETE | `/groups/{id}` | Delete group - Microsoft Graph API |
| DELETE | `/solutions/virtualEvents/townhalls/{townhallId}/presenters/{presenterId}` | Delete virtualEventPresenter |
| DELETE | `/solutions/virtualEvents/webinars/{webinarId}/presenters/{presenterId}` | Delete virtualEventPresenter |
| DELETE | `/solutions/virtualEvents/webinars/{webinarId}/registrationConfiguration/questions/{questionId}` | Delete virtualEventRegistrationQuestionBase |
| DELETE | `/teams/{team-id}/channels/{channel-id}/enabledApps/{app-id}/$ref` | Remove teamsApp |
| DELETE | `/teams/{team-id}/channels/{channel-id}/members/{membership-id}` | Remove member from channel |
| DELETE | `/teams/{team-id}/channels/{channel-id}/sharedWithTeams/{shared-with-channel-team-info-id}` | Delete sharedWithChannelTeamInfo |
| DELETE | `/teams/{team-id}/channels/{channel-id}/tabs/{tab-id}` | Delete tab from channel |
| DELETE | `/teams/{team-id}/incomingChannels/{incoming-channel-id}/$ref` | Remove channel |
| DELETE | `/teams/{team-id}/installedApps/{app-installation-id}` | Remove app from team |
| DELETE | `/teams/{teamsId}/schedule/dayNotes/{dayNoteId}` | Delete dayNote |
| DELETE | `/teams/{id}/schedule/openShifts/{openShiftId}` | Delete openShift |
| DELETE | `/teams/{teamId}/schedule/schedulingGroups/{schedulingGroupId}` | Delete schedulingGroup |
| DELETE | `/teams/{teamId}/schedule/shifts/{shiftId}` | Delete shift |
| DELETE | `/teams/{teamsId}/schedule/timeCards/{timeCardId}` | Delete timeCard |
| DELETE | `/teams/{teamId}/schedule/timeOffReasons/{timeOffReasonId}` | Delete timeOffReason |
| DELETE | `/teams/{teamId}/schedule/timeOffRequests/{timeOffRequestId}` | Delete timeOffRequest |
| DELETE | `/teams/{teamId}/schedule/timesOff/{timeOffId}` | Delete timeOff |
| DELETE | `/teams/{team-id}/tags/{teamworkTag-id}` | Delete teamworkTag |
| DELETE | `/teams/{team-id}/tags/{teamworkTag-id}/members/{teamworkTagMember-id}` | Delete teamworkTagMember |
| DELETE | `/teams/d72f9b8e-4c76-4f50-bf93-51b17aab0cd9/schedule/dayNotes/NOTE_ff2194ab-0ae5-43e3-acb4-ec2654927213` | Delete dayNote |
| DELETE | `/teamwork/workforceIntegrations/{workforceIntegrationId}` | Delete workforceIntegration |
| DELETE | `/users/{userId}/onlineMeetings/{meetingId}` | Delete onlineMeeting |
| DELETE | `/users/{user-id \| user-principal-name}/teamwork/installedApps/{app-installation-id}` | Uninstall app for user |
| GET | `/admin/teams/policy/getPolicyId(type='{policyType}',name='{policyName}')` | teamsPolicyAssignment: getPolicyId |
| GET | `/admin/teams/telephoneNumberManagement/numberAssignments` | List numberAssignments |
| GET | `/admin/teams/telephoneNumberManagement/numberAssignments/{numberAssignmentId}` | Get numberAssignment |
| GET | `/admin/teams/telephoneNumberManagement/operations/{telephoneNumberLongRunningOperationId}` | Get telephoneNumberLongRunningOperation |
| GET | `/admin/teams/userConfigurations` | List userConfigurations |
| GET | `/admin/teams/userConfigurations/{teamsUserConfigurationId}` | Get teamsUserConfiguration |
| GET | `/app/calls/{id}/audioRoutingGroups` | List audioRoutingGroups |
| GET | `/app/calls/{id}/audioRoutingGroups/{id}` | Get audioRoutingGroup |
| GET | `/app/calls/{callId}/operations/{id}` | Get addLargeGalleryViewOperation |
| GET | `/app/onlineMeetings/?$filter=VideoTeleconferenceId%20eq%20'{videoTeleconferenceId}'` | Get onlineMeeting |
| GET | `/appCatalogs/teamsApps` | List teamsApp |
| GET | `/appCatalogs/teamsApps/{app-id}/appDefinitions/{app-definition-id}/bot` | Get teamworkBot |
| GET | `/chats` | List chats |
| GET | `/chats/{chat-id}/installedApps` | List apps in chat |
| GET | `/chats/{chat-id}/installedApps/{app-installation-id}` | Get installed app in chat |
| GET | `/chats/{chat-id}/members/{membership-id}` | Get conversationMember in a chat |
| GET | `/chats/{chat-id}/messages/{message-id}/hostedContents/{hosted-content-id}` | Get chatMessageHostedContent |
| GET | `/chats/{chat-id}/permissionGrants` | List permissionGrants of a chat |
| GET | `/chats/{chat-id}/tabs` | List tabs in chat |
| GET | `/chats/{chat-id}/tabs/{tab-id}` | Get tab in chat |
| GET | `/communications/callRecords` | List callRecords |
| GET | `/communications/callRecords/{id}` | Get callRecord |
| GET | `/communications/callRecords/{id}/participants_v2` | List participants_v2 |
| GET | `/communications/callRecords/{id}/sessions` | List sessions |
| GET | `/communications/callRecords/getDirectRoutingCalls(fromDateTime={fromDateTime},toDateTime={toDateTime})` | callRecord: getDirectRoutingCalls |
| GET | `/communications/callRecords/getPstnCalls(fromDateTime={fromDateTime},toDateTime={toDateTime})` | callRecord: getPstnCalls |
| GET | `/communications/calls/{id}` | Get call |
| GET | `/communications/calls/{id}/audioRoutingGroups` | List audioRoutingGroups |
| GET | `/communications/calls/{id}/audioRoutingGroups/{id}` | Get audioRoutingGroup |
| GET | `/communications/calls/{id}/contentSharingSessions` | List contentSharingSessions |
| GET | `/communications/calls/{id}/contentSharingSessions/{id}` | Get contentSharingSession |
| GET | `/communications/calls/{callId}/operations/{id}` | Get addLargeGalleryViewOperation |
| GET | `/communications/calls/{id}/participants` | List participants |
| GET | `/communications/calls/{id}/participants/{id}` | Get participant |
| GET | `/communications/getAllOnlineMeetingMessages` | cloudCommunications: getAllOnlineMeetingMessages |
| GET | `/communications/onlineMeetingConversations/{onlineMeetingEngagementConversationId}/messages/{engagementConversationMessageId}/reactions` | List reactions |
| GET | `/communications/onlineMeetings/?$filter=VideoTeleconferenceId%20eq%20'{videoTeleconferenceId}'` | Get onlineMeeting |
| GET | `/communications/presences/{id}` | Get presence |
| GET | `/employeeExperience/learningCourseActivities/{Id}` | Get learningCourseActivity |
| GET | `/employeeExperience/learningProviders` | List learningProviders |
| GET | `/employeeExperience/learningProviders/{learningProviderId}` | Get learningProvider |
| GET | `/employeeExperience/learningProviders/{learningProviderId}/learningContents` | List learningContents |
| GET | `/employeeExperience/learningProviders/{learningProviderId}/learningContents(externalId='{externalId}')` | Get learningContent |
| GET | `/employeeExperience/learningProviders/{learningProviderId}/learningContents/{learningContentId}` | Get learningContent |
| GET | `/employeeExperience/learningProviders/{registrationId}/learningCourseActivities(externalCourseActivityId='{externalCourseActivityId}')` | Get learningCourseActivity |
| GET | `/groups/{group-id}/permissionGrants` | List permissionGrants of a group |
| GET | `/me/adhocCalls/{callId}/recordings/{recordingId}` | Get callRecording |
| GET | `/me/adhocCalls/{callId}/recordings/{recordingId}/content` | Get callRecording |
| GET | `/me/adhocCalls/{callId}/transcripts/{transcriptId}` | Get callTranscript |
| GET | `/me/adhocCalls/{callId}/transcripts/{transcriptId}/content` | Get callTranscript |
| GET | `/me/chats/{chat-id}` | Get chat |
| GET | `/me/chats/{chat-id}/messages` | List messages in a chat |
| GET | `/me/chats/{chat-id}/messages/{message-id}` | Get chatMessage in a channel or chat |
| GET | `/me/employeeExperience/learningCourseActivities` | List learningCourseActivities |
| GET | `me/employeeExperience/learningCourseActivities/{id}` | Get learningCourseActivity |
| GET | `/me/licenseDetails` | List licenseDetails |
| GET | `/me/onlineMeetings?$filter=joinMeetingIdSettings/joinMeetingId%20eq%20'{joinMeetingId}'` | Get onlineMeeting |
| GET | `/me/onlineMeetings?$filter=JoinWebUrl%20eq%20'{joinWebUrl}'` | Get onlineMeeting |
| GET | `/me/onlineMeetings/{meetingId}/alternativeRecording` | Get onlineMeeting |
| GET | `/me/onlineMeetings/{meetingId}/attendeeReport` | Get onlineMeeting |
| GET | `/me/onlineMeetings/{onlineMeetingId}/getVirtualAppointmentJoinWebUrl` | virtualAppointment: getVirtualAppointmentJoinWebUrl |
| GET | `/me/onlineMeetings/{meetingId}/recording` | Get onlineMeeting |
| GET | `/solutions/virtualEvents/townhalls` | List townhalls |
| GET | `/solutions/virtualEvents/townhalls/{id}` | Get virtualEventTownhall |
| GET | `/solutions/virtualEvents/townhalls/{townhallId}/presenters` | List presenters |
| GET | `/solutions/virtualEvents/townhalls/{townhallId}/presenters/{presenterId}` | Get virtualEventPresenter |
| GET | `/solutions/virtualEvents/townhalls/{townhallId}/sessions` | List sessions for a virtual event |
| GET | `/solutions/virtualEvents/townhalls/{townhallId}/sessions/{sessionId}` | Get virtualEventSession |
| GET | `/solutions/virtualEvents/townhalls/{townhallId}/sessions/{sessionId}/attendanceReports` | List meetingAttendanceReports |
| GET | `/solutions/virtualEvents/townhalls/{townhallId}/sessions/{sessionId}/attendanceReports/{reportId}` | Get meetingAttendanceReport |
| GET | `/solutions/virtualEvents/townhalls/{townhallId}/sessions/{sessionId}/attendanceReports/{reportId}/attendanceRecords` | List attendanceRecords |
| GET | `/solutions/virtualEvents/townhalls/getByUserIdAndRole(userId='{userId}', role='{role}')` | virtualEventTownhall: getByUserIdAndRole |
| GET | `/solutions/virtualEvents/townhalls/getByUserRole(role='{role}')` | virtualEventTownhall: getByUserRole |
| GET | `/solutions/virtualEvents/webinars` | List webinars |
| GET | `/solutions/virtualEvents/webinars/{webinarId}/presenters` | List presenters |
| GET | `/solutions/virtualEvents/webinars/{webinarId}/presenters/{presenterId}` | Get virtualEventPresenter |
| GET | `/solutions/virtualEvents/webinars/{webinarId}/registrationConfiguration` | Get virtualEventWebinarRegistrationConfiguration |
| GET | `/solutions/virtualEvents/webinars/{webinarId}/registrationConfiguration/questions` | List questions |
| GET | `/solutions/virtualEvents/webinars/{webinarId}/registrations` | List virtualEventRegistrations |
| GET | `/solutions/virtualEvents/webinars/{webinarId}/registrations/{registrationId}` | Get virtualEventRegistration |
| GET | `/solutions/virtualEvents/webinars/{webinarId}/registrations/{registrationId}/sessions` | List sessions for a virtual event registration |
| GET | `/solutions/virtualEvents/webinars/{webinarId}/sessions/{sessionId}` | Get virtualEventSession |
| GET | `/solutions/virtualEvents/webinars/{webinarId}/sessions/{sessionId}/attendanceReports` | List meetingAttendanceReports |
| GET | `/solutions/virtualEvents/webinars/{webinarId}/sessions/{sessionId}/attendanceReports/{reportId}` | Get meetingAttendanceReport |
| GET | `/solutions/virtualEvents/webinars/{webinarId}/sessions/{sessionId}/attendanceReports/{reportId}/attendanceRecords` | List attendanceRecords |
| GET | `/solutions/virtualEvents/webinars/getByUserIdAndRole(userId='{userId}', role='{role}')` | virtualEventWebinar: getByUserIdAndRole |
| GET | `/solutions/virtualEvents/webinars/getByUserRole(role='{role}')` | virtualEventWebinar: getByUserRole |
| GET | `/teams` | List teams |
| GET | `/teams/{team-id}/allChannels` | List allChannels |
| GET | `/teams/{team-id}/channels/{channel-id}/allMembers` | List allMembers |
| GET | `/teams/{team-id}/channels/{channel-id}/doesUserHaveAccess(userId='@userId',tenantId='@tenantId',userPrincipalName='@userPrincipalName')` | channel: doesUserHaveAccess |
| GET | `/teams/{team-id}/channels/{channel-id}/enabledApps` | List enabledApps |
| GET | `/teams/{team-id}/channels/{channel-id}/enabledApps/{app-id}` | Get teamsApp |
| GET | `/teams/{team-id}/channels/{channel-id}/members` | List members of a channel |
| GET | `/teams/{team-id}/channels/{channel-id}/members/{membership-id}` | Get member of channel |
| GET | `/teams/{team-id}/channels/{channel-id}/messages/{message-id}/hostedContents/{hosted-content-id}` | Get chatMessageHostedContent |
| GET | `/teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies/{reply-id}` | Get chatMessage in a channel or chat |
| GET | `/teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies/{reply-id}/hostedContents` | List hostedContents |
| GET | `/teams/{team-id}/channels/{channel-id}/messages/{message-id}/replies/{reply-id}/hostedContents/{hosted-content-id}` | Get chatMessageHostedContent |
| GET | `/teams/{team-id}/channels/{channel-id}/sharedWithTeams` | List sharedWithChannelTeamInfo |
| GET | `/teams/{team-id}/channels/{channel-id}/sharedWithTeams/{shared-with-channel-team-info-id}` | Get sharedWithChannelTeamInfo |
| GET | `/teams/{team-id}/channels/{channel-id}/sharedWithTeams/{shared-with-channel-team-info-id}/allowedMembers` | List allowedMembers |
| GET | `/teams/{team-id}/channels/{channel-id}/tabs/{tab-id}` | Get tab in channel |
| GET | `/teams/{team-id}/channels/getAllMessages` | channel: getAllMessages |
| GET | `/teams/{teamsId}/channels/getAllRetainedMessages` | channel: getAllRetainedMessages |
| GET | `/teams/{team-id}/incomingChannels` | List incomingChannels |
| GET | `/teams/{team-id}/installedApps` | List apps in team |
| GET | `/teams/{id}/installedApps/{id}` | Get installed app in team |
| GET | `/teams/{team-id}/members/{membership-id}` | Get member of team |
| GET | `/teams/{team-id}/permissionGrants` | List permissionGrants of a team |
| GET | `/teams/{id}/primaryChannel` | Get primaryChannel |
| GET | `/teams/{teamId}/schedule` | Get schedule |
| GET | `/teams/{teamsId}/schedule/dayNotes` | List dayNote objects |
| GET | `/teams/{teamsId}/schedule/dayNotes?$filter=dayNoteDate eq 2023-11-3` | List dayNote objects |
| GET | `/teams/{teamsId}/schedule/dayNotes/{dayNoteId}` | Get dayNote |
| GET | `/teams/{teamId}/schedule/offerShiftRequests` | List offerShiftRequest |
| GET | `/teams/{teamId}/schedule/offerShiftRequests/{offerShiftRequestId}` | Get offerShiftRequest |
| GET | `/teams/{id}/schedule/openShiftChangeRequests` | List openShiftChangeRequests |
| GET | `/teams/{id}/schedule/openShiftChangeRequests/{openShiftsChangeRequestId}` | Get openShiftChangeRequest |
| GET | `/teams/{id}/schedule/openShifts` | List openShifts |
| GET | `/teams/{id}/schedule/openShifts/{openShiftId}` | Get openShift |
| GET | `/teams/{teamId}/schedule/schedulingGroups` | List schedulingGroups |
| GET | `/teams/{teamId}/schedule/schedulingGroups/{schedulingGroupId}` | Get schedulingGroup |
| GET | `/teams/{teamId}/schedule/shifts` | List shifts |
| GET | `/teams/{teamId}/schedule/shifts/{shiftId}` | Get shift |
| GET | `/teams/{teamId}/schedule/swapShiftsChangeRequests` | List swapShiftsChangeRequest |
| GET | `/teams/{teamsId}/schedule/timeCards` | List timeCard objects |
| GET | `/teams/{teamsId}/schedule/timeCards/{timeCardId}` | Get timeCard |
| GET | `/teams/{teamId}/schedule/timeOffReasons` | List timeOffReasons |
| GET | `/teams/{teamId}/schedule/timeOffReasons/{timeOffReasonId}` | Get timeOffReason |
| GET | `/teams/{teamId}/schedule/timeOffRequests` | List timeOffRequest |
| GET | `/teams/{teamId}/schedule/timeOffRequests/{timeOffRequestId}` | Get timeOffRequest |
| GET | `/teams/{teamId}/schedule/timesOff` | List timesOff |
| GET | `/teams/{teamId}/schedule/timesOff/{timeOffId}` | Get timeOff |
| GET | `/teams/{team-id}/tags` | List teamworkTags |
| GET | `/teams/{team-id}/tags/{teamworkTag-id}` | Get teamworkTag |
| GET | `/teams/{team-id}/tags/{teamworkTag-id}/members` | List teamworkTagMembers |
| GET | `/teams/{team-id}/tags/{teamworkTag-id}/members/{teamworkTagMember-id}` | Get teamworkTagMember |
| GET | `/teams/d72f9b8e-4c76-4f50-bf93-51b17aab0cd9/schedule/dayNotes` | List dayNote objects |
| GET | `/teams/d72f9b8e-4c76-4f50-bf93-51b17aab0cd9/schedule/dayNotes/NOTE_52191d41-ce2d-4295-a477-b75941bd8e0f` | Get dayNote |
| GET | `/teamwork` | Get teamwork. |
| GET | `/teamwork/deletedChats/{deleted-chat-id}` | Get deletedChat |
| GET | `/teamwork/deletedTeams` | List deletedTeams |
| GET | `/teamwork/teamsAppSettings` | Get teamsAppSettings |
| GET | `/teamwork/workforceIntegrations` | List workforceIntegrations |
| GET | `/teamwork/workforceIntegrations/{workforceIntegrationId}` | Get workforceIntegration |
| GET | `/users/{userId}/adhocCalls/{callId}/recordings/{recordingId}` | Get callRecording |
| GET | `/users/{userId}/adhocCalls/{callId}/recordings/{recordingId}/content` | Get callRecording |
| GET | `/users/{userId}/adhocCalls/{callId}/transcripts/{transcriptId}` | Get callTranscript |
| GET | `/users/{userId}/adhocCalls/{callId}/transcripts/{transcriptId}/content` | Get callTranscript |
| GET | `/users/{usersId}/adhocCalls/getAllRecordings` | adhocCall: getAllRecordings |
| GET | `/users/{usersId}/adhocCalls/getAllTranscripts` | adhocCall: getAllTranscripts |
| GET | `/users/{user-id \| user-principal-name}/chats` | List chats |
| GET | `/users/{user-id \| user-principal-name}/chats/{chat-id}` | Get chat |
| GET | `/users/{user-id \| user-principal-name}/chats/{chat-id}/members` | List members of a chat |
| GET | `/users/{user-id \| user-principal-name}/chats/{chat-id}/members/{membership-id}` | Get conversationMember in a chat |
| GET | `/users/{user-id \| user-principal-name}/chats/{chat-id}/messages` | List messages in a chat |
| GET | `/users/{user-id \| user-principal-name}/chats/{chat-id}/messages/{message-id}` | Get chatMessage in a channel or chat |
| GET | `/users/{user-id \| user-principal-name}/chats/{chat-id}/messages/{message-id}/hostedContents` | List hostedContents |
| GET | `/users/{user-id \| user-principal-name}/chats/{chat-id}/messages/{message-id}/hostedContents/{hosted-content-id}` | Get chatMessageHostedContent |
| GET | `/users/{id \| user-principal-name}/chats/getAllMessages/delta` | chats-getAllMessages: delta |
| GET | `/users/{id}/chats/getAllRetainedMessages` | chat: getAllRetainedMessages |
| GET | `/users/{user-id}/employeeExperience/learningCourseActivities` | List learningCourseActivities |
| GET | `users/{user-id}/employeeExperience/learningCourseActivities/{id}` | Get learningCourseActivity |
| GET | `/users/{id \| user-principal-name}/joinedTeams` | List joinedTeams |
| GET | `/users/{id}/licenseDetails` | List licenseDetails |
| GET | `/users/{user-id}/licenseDetails/getTeamsLicensingDetails` | licenseDetails: getTeamsLicensingDetails |
| GET | `/users/{userId}/onlineMeetings?$filter=joinMeetingIdSettings/joinMeetingId%20eq%20'{joinMeetingId}'` | Get onlineMeeting |
| GET | `/users/{userId}/onlineMeetings?$filter=JoinWebUrl%20eq%20'{joinWebUrl}'` | Get onlineMeeting |
| GET | `/users/{userId}/onlineMeetings/{meetingId}` | Get onlineMeeting |
| GET | `/users/{userId}/onlineMeetings/{meetingId}/alternativeRecording` | Get onlineMeeting |
| GET | `/users/{userId}/onlineMeetings/{meetingId}/attendanceReports` | List meetingAttendanceReports |
| GET | `/users/{userId}/onlineMeetings/{meetingId}/attendanceReports/{reportId}` | Get meetingAttendanceReport |
| GET | `/users/{userId}/onlineMeetings/{meetingId}/attendanceReports/{reportId}/attendanceRecords` | List attendanceRecords |
| GET | `/users/{userId}/onlineMeetings/{meetingId}/attendeeReport` | Get onlineMeeting |
| GET | `/users/{userId}/onlineMeetings/{onlineMeetingId}/getVirtualAppointmentJoinWebUrl` | virtualAppointment: getVirtualAppointmentJoinWebUrl |
| GET | `/users/{userId}/onlineMeetings/{meetingId}/recording` | Get onlineMeeting |
| GET | `/users/{userId}/onlineMeetings/{meetingId}/recordings` | List recordings |
| GET | `/users/{userId}/onlineMeetings/{meetingId}/recordings/{recordingId}` | Get callRecording |
| GET | `/users/{userId}/onlineMeetings/{meetingId}/recordings/{recordingId}/content` | Get callRecording |
| GET | `/users/{user-id}/onlineMeetings/{online-meeting-id}/transcripts` | List transcripts |
| GET | `/users/{userId}/onlineMeetings/{meetingId}/transcripts/{transcriptId}` | Get callTranscript |
| GET | `/users/{userId}/onlineMeetings/{meetingId}/transcripts/{transcriptId}/content` | Get callTranscript |
| GET | `/users/{usersId}/onlineMeetings/getAllRecordings(meetingOrganizerUserId='{userId}',startDateTime={startDateTime},endDateTime={endDateTime})` | onlineMeeting: getAllRecordings |
| GET | `/users/{usersId}/onlineMeetings/getAllRecordings(meetingOrganizerUserId='{userId}',startDateTime={startDateTime})/delta` | callRecording: delta |
| GET | `/users/{usersId}/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='{userId}',startDateTime={startDateTime},endDateTime={endDateTime})` | onlineMeeting: getAllTranscripts |
| GET | `/users/{usersId}/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='{userId}',startDateTime={startDateTime})/delta` | callTranscript: delta |
| GET | `/users/{user-id}/permissionGrants` | List permissionGrants of a user |
| GET | `/users/{userId}/settings/shiftPreferences` | Get shiftPreferences |
| GET | `/users/{usersId}/solutions/schedule` | Get workingTimeSchedule |
| GET | `/users/{user-id}/teamwork` | Get userTeamwork |
| GET | `/users/{user-id}/teamwork/associatedTeams` | List associatedTeamInfo |
| GET | `/users/{user-id \| user-principal-name}/teamwork/installedApps` | List apps installed for user |
| GET | `/users/{user-id \| user-principal-name}/teamwork/installedApps/{app-installation-id}` | Get installed app for user |
| GET | `/users/{user-id \| user-principal-name}/teamwork/installedApps/{app-installation-id}/chat` | Get chat between user and teamsApp |
| PATCH | `/app/calls/{id}/audioRoutingGroups/{id}` | Update audioRoutingGroup |
| PATCH | `/chats/{chat-id}` | Update chat |
| PATCH | `/chats/{chatThread-id}/messages/{message-id}` | Update chatMessage |
| PATCH | `/chats/{chat-id}/tabs/{tab-id}` | Update tab in chat |
| PATCH | `/communications/calls/{id}/audioRoutingGroups/{id}` | Update audioRoutingGroup |
| PATCH | `/employeeExperience/learningProviders/{learningProviderId}` | Update learningProvider |
| PATCH | `/employeeExperience/learningProviders/{learningProviderId}/learningContents(externalId='{externalId}')` | Update learningContent |
| PATCH | `/employeeExperience/learningProviders/{learningProviderId}/learningContents/{learningContentId}` | Update learningContent |
| PATCH | `/employeeExperience/learningProviders/{registrationId}/learningCourseActivities/{learningCourseActivityId}` | Update learningCourseActivity |
| PATCH | `/solutions/virtualEvents/townhalls/{id}` | Update virtualEventTownhall |
| PATCH | `/solutions/virtualEvents/webinars/{id}` | Update virtualEventWebinar |
| PATCH | `/solutions/virtualEvents/webinars/{webinarId}/presenters/{presenterId}` | Update virtualEventPresenter |
| PATCH | `/teams/(team-id)/channels/{channel-id}/messages/{message-id}` | Update chatMessage |
| PATCH | `/teams/(team-id)/channels/{channel-id}/messages/{message-id}/replies/{reply-id}` | Update chatMessage |
| PATCH | `/teams/{team-id}` | Update team |
| PATCH | `/teams/{team-id}/channels/{channel-id}/members/{membership-id}` | Update member in channel |
| PATCH | `/teams/{team-id}/channels/{channel-id}/tabs/{tab-id}` | Update tab |
| PATCH | `/teams/{team-id}/members/{membership-id}` | Update member in team |
| PATCH | `/teams/{team-id}/tags/{teamworkTag-id}` | Update teamworkTag |
| PATCH | `/teamwork/teamsAppSettings` | Update teamsAppSettings |
| PATCH | `/teamwork/workforceIntegrations/{workforceIntegrationId}` | Update workforceIntegration |
| PATCH | `/users/{userId}/onlineMeetings/{meetingId}` | Update onlineMeeting |
| PATCH | `/users/{userId}/settings/shiftPreferences` | Update shiftPreferences |
| POST | `/admin/teams/policy/userAssignments/assign` | teamsPolicyUserAssignment: assign |
| POST | `/admin/teams/policy/userAssignments/unassign` | teamsPolicyUserAssignment: unassign |
| POST | `/admin/teams/telephoneNumberManagement/numberAssignments/assignNumber` | numberAssignment: assignNumber |
| POST | `/admin/teams/telephoneNumberManagement/numberAssignments/unassignNumber` | numberAssignment: unassignNumber |
| POST | `/admin/teams/telephoneNumberManagement/numberAssignments/updateNumber` | numberAssignment: updateNumber |
| POST | `/app/calls/{id}/addLargeGalleryView` | call: addLargeGalleryView |
| POST | `/app/calls/{id}/audioRoutingGroups` | Create audioRoutingGroup |
| POST | `/app/calls/{id}/sendDtmfTones` | call: sendDtmfTones |
| POST | `/appCatalogs/teamsApps` | Publish teamsApp |
| POST | `/appCatalogs/teamsApps?requiresReview={Boolean}` | Publish teamsApp |
| POST | `/appCatalogs/teamsApps/{id}/appDefinitions` | Update teamsApp |
| POST | `/chats` | Create chat |
| POST | `/chats/{chat-id}/installedApps` | Add app to chat |
| POST | `/chats/{chat-id}/installedApps/{app-installation-id}/upgrade` | teamsAppInstallation in chat: upgrade |
| POST | `/chats/{chat-id}/members` | Add member to a chat |
| POST | `/chats/{chatId}/messages/replyWithQuote` | chatMessage: replyWithQuote |
| POST | `/chats/{chatsId}/removeAllAccessForUser` | chat: removeAllAccessForUser |
| POST | `/chats/{chatId}/sendActivityNotification` | chat: sendActivityNotification |
| POST | `/chats/{chat-id}/tabs` | Add tab to chat |
| POST | `/communications/calls` | Create call |
| POST | `/communications/calls/{id}/addLargeGalleryView` | call: addLargeGalleryView |
| POST | `/communications/calls/{id}/answer` | call: answer |
| POST | `/communications/calls/{id}/audioRoutingGroups` | Create audioRoutingGroup |
| POST | `/communications/calls/{id}/cancelMediaProcessing` | call: cancelMediaProcessing |
| POST | `/communications/calls/{id}/changeScreenSharingRole` | call: changeScreenSharingRole |
| POST | `/communications/calls/{id}/keepAlive` | call: keepAlive |
| POST | `/communications/calls/{id}/mute` | call: mute |
| POST | `/communications/calls/{id}/participants/{id}/mute` | participant: mute |
| POST | `/communications/calls/{id}/participants/{id}/startHoldMusic` | participant: startHoldMusic |
| POST | `/communications/calls/{id}/participants/{id}/stopHoldMusic` | participant: stopHoldMusic |
| POST | `/communications/calls/{id}/participants/invite` | participant: invite |
| POST | `/communications/calls/{id}/playPrompt` | call: playPrompt |
| POST | `/communications/calls/{id}/recordResponse` | call: recordResponse |
| POST | `/communications/calls/{id}/redirect` | call: redirect |
| POST | `/communications/calls/{id}/reject` | call: reject |
| POST | `/communications/calls/{id}/sendDtmfTones` | call: sendDtmfTones |
| POST | `/communications/calls/{id}/subscribeToTone` | call: subscribeToTone |
| POST | `/communications/calls/{id}/transfer` | call: transfer |
| POST | `/communications/calls/{id}/unmute` | call: unmute |
| POST | `/communications/calls/{id}/updateRecordingStatus` | call: updateRecordingStatus |
| POST | `/communications/calls/logTeleconferenceDeviceQuality` | call: logTeleconferenceDeviceQuality |
| POST | `/communications/getPresencesByUserId` | cloudCommunications: getPresencesByUserId |
| POST | `/employeeExperience/learningProviders` | Create learningProvider |
| POST | `/employeeExperience/learningProviders/{registrationId}/learningCourseActivities` | Create learningCourseActivity |
| POST | `/groups/{team-id}/team/channels/{channel-id}/archive` | channel: archive |
| POST | `/groups/{team-id}/team/channels/{channel-id}/unarchive` | channel: unarchive |
| POST | `/me/onlineMeetings/{onlineMeetingId}/sendVirtualAppointmentReminderSms` | virtualAppointment: sendVirtualAppointmentReminderSms |
| POST | `/me/onlineMeetings/{onlineMeetingId}/sendVirtualAppointmentSms` | virtualAppointment: sendVirtualAppointmentSms |
| POST | `/me/onlineMeetings/createOrGet` | onlineMeeting: createOrGet |
| POST | `/me/presence/clearAutomaticLocation` | presence: clearAutomaticLocation |
| POST | `/me/presence/clearLocation` | presence: clearLocation |
| POST | `/me/presence/setAutomaticLocation` | presence: setAutomaticLocation |
| POST | `/me/presence/setManualLocation` | presence: setManualLocation |
| POST | `/solutions/virtualEvents/townhalls` | Create virtualEventTownhall |
| POST | `/solutions/virtualEvents/townhalls/{id}/cancel` | virtualEventTownhall: cancel |
| POST | `/solutions/virtualEvents/townhalls/{townhallId}/presenters` | Create virtualEventPresenter |
| POST | `/solutions/virtualEvents/townhalls/{id}/publish` | virtualEventTownhall: publish |
| POST | `/solutions/virtualEvents/townhalls/{id}/setExternalEventInformation` | virtualEvent: setExternalEventInformation |
| POST | `/solutions/virtualEvents/webinars` | Create virtualEventWebinar |
| POST | `/solutions/virtualEvents/webinars/{id}/cancel` | virtualEventWebinar: cancel |
| POST | `/solutions/virtualEvents/webinars/{webinarId}/presenters` | Create virtualEventPresenter |
| POST | `/solutions/virtualEvents/webinars/{id}/publish` | virtualEventWebinar: publish |
| POST | `/solutions/virtualEvents/webinars/{webinarId}/registrationConfiguration/questions` | Create virtualEventRegistrationCustomQuestion |
| POST | `/solutions/virtualEvents/webinars/{webinarId}/registrations` | Create virtualEventRegistration |
| POST | `/solutions/virtualEvents/webinars/{webinarId}/registrations/{registrationId}/cancel` | virtualEventRegistration: cancel |
| POST | `/solutions/virtualEvents/webinars/{id}/setExternalEventInformation` | virtualEvent: setExternalEventInformation |
| POST | `/subscriptions` | Create subscription |
| POST | `/teams` | Create team |
| POST | `/teams/{id}/archive` | Archive team |
| POST | `/teams/{team-id}/channels/{channel-id}/archive` | channel: archive |
| POST | `/teams/{team-id}/channels/{channel-id}/completeMigration` | channel: completeMigration |
| POST | `/teams/{team-id}/channels/{channel-id}/enabledApps/$ref` | Add teamsApp |
| POST | `/teams/{team-id}/channels/{channel-id}/members` | Add member to channel |
| POST | `/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies/{replyId}/setReaction` | chatMessage: setReaction |
| POST | `/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies/{replyId}/softDelete` | chatMessage: softDelete |
| POST | `/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies/{replyId}/undoSoftDelete` | chatMessage: undoSoftDelete |
| POST | `/teams/{teamId}/channels/{channelId}/messages/{messageId}/replies/{replyId}/unsetReaction` | chatMessage: unsetReaction |
| POST | `/teams/{teamsId}/channels/{channelId}/messages/{chatMessageId}/softDelete` | chatMessage: softDelete |
| POST | `/teams/{teamsId}/channels/{channelId}/messages/{chatMessageId}/undoSoftDelete` | chatMessage: undoSoftDelete |
| POST | `/teams/{team-id}/channels/{channel-id}/provisionEmail` | channel: provisionEmail |
| POST | `/teams/{team-id}/channels/{channel-id}/removeEmail` | channel: removeEmail |
| POST | `/teams/{team-id}/channels/{channel-id}/tabs` | Add tab to channel |
| POST | `/teams/{team-id}/channels/{channel-id}/unarchive` | channel: unarchive |
| POST | `/teams/{id}/clone` | team: clone |
| POST | `/teams/{team-id}/completeMigration` | team: completeMigration |
| POST | `/teams/{team-id}/installedApps` | Add app to team |
| POST | `/teams/{team-id}/installedApps/{app-installation-id}/upgrade` | teamsAppInstallation in a team: upgrade |
| POST | `/teams/{team-id}/members/add` | conversationMember: add |
| POST | `/teams/{team-id}/members/remove` | conversationMember: remove |
| POST | `/teams/{teamsId}/schedule/dayNotes` | Create dayNote |
| POST | `/teams/{teamId}/schedule/offerShiftRequests` | Create offerShiftRequest |
| POST | `/teams/{teamId}/schedule/offerShiftRequests/{offerShiftRequestId}/approve` | offerShiftRequest: approve |
| POST | `/teams/{teamId}/schedule/offerShiftRequests/{offerShiftRequestId}/decline` | offerShiftRequest: decline |
| POST | `/teams/{id}/schedule/openShiftChangeRequests` | Create openShiftChangeRequest |
| POST | `/teams/{id}/schedule/openShiftChangeRequests/{openShiftChangeRequestId}/approve` | openShiftChangeRequest: approve |
| POST | `/teams/{id}/schedule/openShiftChangeRequests/{openShiftChangeRequestId}/decline` | openShiftChangeRequest: decline |
| POST | `/teams/{id}/schedule/openShifts` | Create openShift |
| POST | `/teams/{teamsId}/schedule/openShifts/{openShiftId}/stageForDeletion` | changeTrackedEntity: stageForDeletion |
| POST | `/teams/{teamId}/schedule/schedulingGroups` | Create schedulingGroup |
| POST | `/teams/{teamId}/schedule/share` | schedule: share |
| POST | `/teams/{teamId}/schedule/shifts` | Create shift |
| POST | `/teams/{teamsId}/schedule/shifts/{shiftId}/stageForDeletion` | changeTrackedEntity: stageForDeletion |
| POST | `/teams/{teamId}/schedule/swapShiftsChangeRequests` | Create swapshiftRequest |
| POST | `/teams/{teamId}/schedule/swapShiftsChangeRequests/{swapShiftChangeRequestId}/approve` | swapShiftsChangeRequest: approve |
| POST | `/teams/{teamId}/schedule/swapShiftsChangeRequests/{swapShiftChangeRequestId}/decline` | swapShiftsChangeRequest: decline |
| POST | `/teams/{teamsId}/schedule/timeCards` | Create timeCard |
| POST | `/teams/{teamsId}/schedule/timeCards/{timeCardId}/clockOut` | timeCard: clockOut |
| POST | `/teams/{teamsId}/schedule/timeCards/{timeCardId}/confirm` | timeCard: confirm |
| POST | `/teams/{teamsId}/schedule/timeCards/{timeCardId}/endBreak` | timeCard: endBreak |
| POST | `/teams/{teamsId}/schedule/timeCards/{timeCardId}/startBreak` | timeCard: startBreak |
| POST | `/teams/{teamId}/schedule/timeCards/clockIn` | timeCard: clockIn |
| POST | `/teams/{teamId}/schedule/timeOffReasons` | Create timeOffReason |
| POST | `/teams/{teamId}/schedule/timeOffRequests` | Create timeOffRequest |
| POST | `/teams/{teamId}/schedule/timeOffRequests/{timeOffRequestId}/approve` | timeOffRequest: approve |
| POST | `/teams/{teamId}/schedule/timeOffRequests/{timeOffRequestId}/decline` | timeOffRequest: decline |
| POST | `/teams/{teamId}/schedule/timesOff` | Create timeOff |
| POST | `/teams/{teamsId}/schedule/timesOff/{timeOffId}/stageForDeletion` | changeTrackedEntity: stageForDeletion |
| POST | `/teams/{teamId}/sendActivityNotification` | team: sendActivityNotification |
| POST | `/teams/{team-id}/tags` | Create teamworkTag |
| POST | `/teams/{team-id}/tags/{teamworkTag-id}/members` | Create teamworkTagMember |
| POST | `/teams/{id}/unarchive` | Unarchive team |
| POST | `/teams/d72f9b8e-4c76-4f50-bf93-51b17aab0cd9/schedule/dayNotes` | Create dayNote |
| POST | `/teamwork/deletedChats/{deletedChatId}/undoDelete` | deletedChat: undoDelete |
| POST | `/teamwork/sendActivityNotificationToRecipients` | teamwork: sendActivityNotificationToRecipients |
| POST | `/teamwork/workforceIntegrations` | Create workforceIntegration |
| POST | `/users/{userId}/chats/{chatsId}/messages/{chatMessageId}/softDelete` | chatMessage: softDelete |
| POST | `/users/{userId}/chats/{chatsId}/messages/{chatMessageId}/undoSoftDelete` | chatMessage: undoSoftDelete |
| POST | `/users/{userId}/onlineMeetings` | Create onlineMeeting |
| POST | `/users/{userId}/onlineMeetings/{onlineMeetingId}/sendVirtualAppointmentReminderSms` | virtualAppointment: sendVirtualAppointmentReminderSms |
| POST | `/users/{userId}/onlineMeetings/{onlineMeetingId}/sendVirtualAppointmentSms` | virtualAppointment: sendVirtualAppointmentSms |
| POST | `/users/{userId}/onlineMeetings/createOrGet` | onlineMeeting: createOrGet |
| POST | `/users/{id}/presence/clearPresence` | presence: clearPresence |
| POST | `/users/{id}/presence/clearUserPreferredPresence` | presence: clearUserPreferredPresence |
| POST | `/users/{id}/presence/setPresence` | presence: setPresence |
| POST | `/users/{id}/presence/setStatusMessage` | presence: setStatusMessage |
| POST | `/users/{id}/presence/setUserPreferredPresence` | presence: setUserPreferredPresence |
| POST | `/users/{userId}/solutions/workingTimeSchedule/endWorkingTime` | workingTimeSchedule: endWorkingTime |
| POST | `/users/{userId}/solutions/workingTimeSchedule/startWorkingTime` | workingTimeSchedule: startWorkingTime |
| POST | `/users/{user-id \| user-principal-name}/teamwork/installedApps` | Install app for user |
| POST | `/users/{user-id \| user-principal-name}/teamwork/installedApps/{app-installation-id}/upgrade` | teamsAppInstallation in personal scope: upgrade |
| POST | `/users/{userId \| user-principal-name}/teamwork/sendActivityNotification` | userTeamwork: sendActivityNotification |
| PUT | `/groups/{id}/team` | Create team from group |
| PUT | `/teams/{teamId}/schedule` | Create or replace schedule |
| PUT | `/teams/{teamsId}/schedule/dayNotes/{dayNoteId}` | Update dayNote |
| PUT | `/teams/{id}/schedule/openShifts/{openShiftId}` | Update openShift |
| PUT | `/teams/{teamId}/schedule/schedulingGroups/{schedulingGroupId}` | Replace schedulingGroup |
| PUT | `/teams/{teamId}/schedule/shifts/{shiftId}` | Replace shift |
| PUT | `/teams/{teamsId}/schedule/timeCards/{timeCardId}` | Replace timeCard |
| PUT | `/teams/{teamId}/schedule/timeOffReasons/{timeOffReasonId}` | Replace timeOffReason |
| PUT | `/teams/{teamId}/schedule/timesOff/{timeOffId}` | Replace timeOff |
| PUT | `/teams/d72f9b8e-4c76-4f50-bf93-51b17aab0cd9/schedule/dayNotes/NOTE_ff2194ab-0ae5-43e3-acb4-ec2654927213` | Update dayNote |

### Users — 262 missing of 303

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/directory/deletedItems/{id}` | Permanently delete an item (directory object) |
| DELETE | `/groups/{id}/photo/$value` | Delete profilePhoto |
| DELETE | `/me/photo/$value` | Delete profilePhoto |
| DELETE | `/users/{id \| userPrincipalName}` | Delete a user - Microsoft Graph API |
| DELETE | `/users/{id}/appRoleAssignments/{id}` | Delete appRoleAssignment |
| DELETE | `/users/{id}/manager/$ref` | Remove manager |
| DELETE | `/users/{id \| userPrincipalName}/photo/$value` | Delete profilePhoto |
| DELETE | `/users/{id}/sponsors/{id}/$ref` | Remove sponsor |
| DELETE | `/users/{user-id \| user-principal-name}/teamwork/installedApps/{app-installation-id}` | Uninstall app for user |
| GET | `/directory/deletedItems/{object-id}` | Get deleted item (directory object) |
| GET | `/directory/deletedItems/microsoft.graph.administrativeUnit` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.application` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.certificateAuthorityDetail` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.certificateBasedAuthPki` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.group` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.servicePrincipal` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.user` | List deleted items (directory objects) |
| GET | `/directoryObjects/delta?$filter=id eq '{id}'` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.administrativeUnit')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.application')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.appRoleAssignment') or isof('microsoft.graph.user')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.device')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.directoryRole')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.group')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.orgContact')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.servicePrincipal')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.user')` | directoryObject: delta |
| GET | `/drives/{driveId}` | Get drive |
| GET | `/groups/{groupId}/drive` | Get drive |
| GET | `/groups/{group-id}/drive/items/{item-id}/children` | List the contents of a folder |
| GET | `/groups/{id}/onenote/notebooks` | List notebooks |
| GET | `/groups/{id}/photo` | Get profilePhoto |
| GET | `/groups/{id}/photo/$value` | Get profilePhoto |
| GET | `/groups/{id}/photos/{size}` | Get profilePhoto |
| GET | `/me?$expand=directReports` | List directReports |
| GET | `/me/agreementAcceptances` | List agreementAcceptances |
| GET | `/me/appRoleAssignments` | List appRoleAssignments granted to a user |
| GET | `/me/calendar/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List calendarView |
| GET | `/me/calendar/events` | List events |
| GET | `/me/calendarGroups` | List calendarGroups |
| GET | `/me/calendarGroups/{calendar_group_id}/calendars` | List calendars |
| GET | `/me/calendarGroups/{id}/calendars/{id}/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List calendarView |
| GET | `/me/calendarGroups/{id}/calendars/{id}/events` | List events |
| GET | `/me/calendars/{id}/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List calendarView |
| GET | `/me/cloudPCs` | List cloudPCs for user |
| GET | `/me/contactFolders` | List contactFolders |
| GET | `/me/contactFolders/{id}/childFolders/{id}/.../contacts` | List contacts |
| GET | `/me/contactfolders/{Id}/contacts` | List contacts |
| GET | `/me/contactfolders/{contactFolderId}/contacts/{id}/photo` | Get profilePhoto |
| GET | `/me/contactfolders/{contactFolderId}/contacts/{id}/photo/$value` | Get profilePhoto |
| GET | `/me/contacts/{id}/photo` | Get profilePhoto |
| GET | `/me/contacts/{id}/photo/$value` | Get profilePhoto |
| GET | `/me/createdObjects` | List createdObjects |
| GET | `/me/drive` | Get drive |
| GET | `/me/drive/items/{item-id}/children` | List the contents of a folder |
| GET | `/me/employeeExperience/assignedRoles` | List assignedRoles |
| GET | `/me/inferenceClassification/overrides` | List overrides |
| GET | `/me/insights/shared` | List shared (deprecated) |
| GET | `/me/insights/trending/{id}/resource` | List trending |
| GET | `/me/licenseDetails` | List licenseDetails |
| GET | `/me/mailboxSettings/automaticRepliesSetting` | Get user mailbox settings |
| GET | `/me/mailboxSettings/dateFormat` | Get user mailbox settings |
| GET | `/me/mailboxSettings/delegateMeetingMessageDeliveryOptions` | Get user mailbox settings |
| GET | `/me/mailboxSettings/language` | Get user mailbox settings |
| GET | `/me/mailboxSettings/timeFormat` | Get user mailbox settings |
| GET | `/me/mailboxSettings/timeZone` | Get user mailbox settings |
| GET | `/me/mailboxSettings/userPurpose` | Get user mailbox settings |
| GET | `/me/mailboxSettings/workingHours` | Get user mailbox settings |
| GET | `/me/mailFolders/?includeHiddenFolders=true` | List mailFolders |
| GET | `/me/mailFolders/inbox/messageRules` | List rules |
| GET | `/me/oauth2PermissionGrants` | List a user's oauth2PermissionGrants |
| GET | `/me/outlook/masterCategories` | List masterCategories |
| GET | `/me/outlook/supportedLanguages` | outlookUser: supportedLanguages |
| GET | `/me/outlook/supportedTimeZones` | outlookUser: supportedTimeZones |
| GET | `/me/outlook/supportedTimeZones(TimeZoneStandard=microsoft.graph.timeZoneStandard'{timezone_format}')` | outlookUser: supportedTimeZones |
| GET | `/me/ownedDevices` | List ownedDevices |
| GET | `/me/ownedObjects` | List ownedObjects |
| GET | `/me/photo` | Get profilePhoto |
| GET | `/me/photos` | Get profilePhoto |
| GET | `/me/photos/{size}` | Get profilePhoto |
| GET | `/me/registeredDevices` | List registeredDevices |
| GET | `/me/settings/` | Get settings |
| GET | `/me/transitiveMemberOf` | List a user's memberships (direct and transitive) |
| GET | `/sites/{siteId}/drive` | Get drive |
| GET | `/sites/{site-id}/drive/items/{item-id}/children` | List the contents of a folder |
| GET | `/sites/{id}/onenote/notebooks` | List notebooks |
| GET | `/teams/{id}/photo` | Get profilePhoto |
| GET | `/teams/{id}/photo/$value` | Get profilePhoto |
| GET | `/users?$expand=manager` | List manager |
| GET | `/users/{id \| userPrincipalName}` | Get user |
| GET | `/users/{id \| userPrincipalName}?$expand=directReports` | List directReports |
| GET | `/users/{id \| userPrincipalName}/?$expand=manager($levels=n)` | List manager |
| GET | `/users/{id \| userPrincipalName}/agreementAcceptances` | List agreementAcceptances |
| GET | `/users/{id \| userPrincipalName}/appRoleAssignments` | List appRoleAssignments granted to a user |
| GET | `/users/{id \| userPrincipalName}/calendarGroups` | List calendarGroups |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{calendar_group_id}/calendars` | List calendars |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List calendarView |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}/events` | List events |
| GET | `/users/{id \| userPrincipalName}/calendars` | List calendars |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List calendarView |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}/events` | List events |
| GET | `/users/{id \| userPrincipalName}/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List calendarView |
| GET | `/users/{id \| userPrincipalName}/contactFolders` | List contactFolders |
| GET | `/users/{id \| userPrincipalName}/contactFolders/{id}/childFolders/{id}/contacts` | List contacts |
| GET | `/users/{id \| userPrincipalName}/contactfolders/{id}/contacts` | List contacts |
| GET | `/users/{id \| userPrincipalName}/contactfolders/{contactFolderId}/contacts/{id}/photo` | Get profilePhoto |
| GET | `/users/{id \| userPrincipalName}/contactfolders/{contactFolderId}/contacts/{id}/photo/$value` | Get profilePhoto |
| GET | `/users/{id \| userPrincipalName}/contacts` | List contacts |
| GET | `/users/{id \| userPrincipalName}/contacts/{id}/photo` | Get profilePhoto |
| GET | `/users/{id \| userPrincipalName}/contacts/{id}/photo/$value` | Get profilePhoto |
| GET | `/users/{id \| userPrincipalName}/createdObjects` | List createdObjects |
| GET | `/users/{user-id \| userPrincipalName}/drive/items/{item-id}/children` | List the contents of a folder |
| GET | `/users/{userId}/employeeExperience/assignedRoles` | List assignedRoles |
| GET | `/users/{id \| userPrincipalName}/events` | List events |
| GET | `/users/{id}/inferenceClassification/overrides` | List overrides |
| GET | `/users/{id \| userPrincipalName}/insights/shared` | List shared (deprecated) |
| GET | `/users/{id \| userPrincipalName}/insights/trending` | List trending |
| GET | `/users/{id \| userPrincipalName}/insights/trending/{id}/resource` | List trending |
| GET | `/users/{id \| user-principal-name}/joinedTeams` | List joinedTeams |
| GET | `/users/{id}/licenseDetails` | List licenseDetails |
| GET | `/users/{id\|userPrincipalName}/mailboxSettings` | Get user mailbox settings |
| GET | `/users/{id\|userPrincipalName}/mailboxSettings/automaticRepliesSetting` | Get user mailbox settings |
| GET | `/users/{id\|userPrincipalName}/mailboxSettings/dateFormat` | Get user mailbox settings |
| GET | `/users/{id\|userPrincipalName}/mailboxSettings/delegateMeetingMessageDeliveryOptions` | Get user mailbox settings |
| GET | `/users/{id\|userPrincipalName}/mailboxSettings/language` | Get user mailbox settings |
| GET | `/users/{id\|userPrincipalName}/mailboxSettings/timeFormat` | Get user mailbox settings |
| GET | `/users/{id\|userPrincipalName}/mailboxSettings/timeZone` | Get user mailbox settings |
| GET | `/users/{id\|userPrincipalName}/mailboxSettings/userPurpose` | Get user mailbox settings |
| GET | `/users/{id\|userPrincipalName}/mailboxSettings/workingHours` | Get user mailbox settings |
| GET | `/users/{id \| userPrincipalName}/mailFolders` | List mailFolders |
| GET | `/users/{id \| userPrincipalName}/mailFolders/?includeHiddenFolders=true` | List mailFolders |
| GET | `/users/{id \| userPrincipalName}/mailFolders/inbox/messageRules` | List rules |
| GET | `/users/{id \| userPrincipalName}/memberOf` | List a user's direct memberships |
| GET | `/users/{id \| userPrincipalName}/oauth2PermissionGrants` | List a user's oauth2PermissionGrants |
| GET | `/users/{id \| userPrincipalName}/onenote/notebooks` | List notebooks |
| GET | `/users/{id\|userPrincipalName}/outlook/masterCategories` | List masterCategories |
| GET | `/users/{id\|userPrincipalName}/outlook/supportedLanguages` | outlookUser: supportedLanguages |
| GET | `/users/{id\|userPrincipalName}/outlook/supportedTimeZones` | outlookUser: supportedTimeZones |
| GET | `/users/{id\|userPrincipalName}/outlook/supportedTimeZones(TimeZoneStandard=microsoft.graph.timeZoneStandard'{timezone_format}')` | outlookUser: supportedTimeZones |
| GET | `/users/{id \| userPrincipalName}/ownedDevices` | List ownedDevices |
| GET | `/users/{id \| userPrincipalName}/ownedObjects` | List ownedObjects |
| GET | `/users/{id \| userPrincipalName}/people` | List people |
| GET | `/users/{user-id}/permissionGrants` | List permissionGrants of a user |
| GET | `/users/{id \| userPrincipalName}/photo` | Get profilePhoto |
| GET | `/users/{id \| userPrincipalName}/photos/{size}` | Get profilePhoto |
| GET | `/users/{id}/planner/tasks` | List tasks |
| GET | `/users/{id \| userPrincipalName}/registeredDevices` | List registeredDevices |
| GET | `/users/{id \| userPrincipalName}/reminderView(startDateTime={startDateTime-value},endDateTime={endDateTime-value})` | user: reminderView |
| GET | `/users/{id \| userPrincipalName}/settings/` | Get settings |
| GET | `/users/{id \| userPrincipalName}/sponsors` | List sponsors |
| GET | `/users/{user-id}/teamwork/associatedTeams` | List associatedTeamInfo |
| GET | `/users/{user-id \| user-principal-name}/teamwork/installedApps` | List apps installed for user |
| GET | `/users/{user-id \| user-principal-name}/teamwork/installedApps/{app-installation-id}` | Get installed app for user |
| GET | `/users/{user-id \| user-principal-name}/teamwork/installedApps/{app-installation-id}/chat` | Get chat between user and teamsApp |
| GET | `/users/{id\|userPrincipalName}/todo/lists` | List lists |
| GET | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks` | List Todo tasks |
| GET | `/users/{id \| userPrincipalName}/transitiveMemberOf` | List a user's memberships (direct and transitive) |
| GET | `/users/delta` | user: delta |
| PATCH | `/groups/{id}/photo/$value` | Update profilePhoto |
| PATCH | `/me/contactfolders/{contactFolderId}/contacts/{id}/photo/$value` | Update profilePhoto |
| PATCH | `/me/contacts/{id}/photo/$value` | Update profilePhoto |
| PATCH | `/me/photo/$value` | Update profilePhoto |
| PATCH | `/me/settings` | Update userSettings |
| PATCH | `/users/{id \| userPrincipalName}` | Update user |
| PATCH | `/users/{id \| userPrincipalName}/contactfolders/{contactFolderId}/contacts/{id}/photo/$value` | Update profilePhoto |
| PATCH | `/users/{id \| userPrincipalName}/contacts/{id}/photo/$value` | Update profilePhoto |
| PATCH | `/users/{id\|userPrincipalName}/mailboxSettings` | Update user mailbox settings |
| PATCH | `/users/{id \| userPrincipalName}/photo/$value` | Update profilePhoto |
| PATCH | `/users/{id \| userPrincipalName}/settings/` | Update userSettings |
| POST | `/contacts/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/contacts/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/contacts/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/contacts/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/devices/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/devices/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/devices/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/devices/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/directory/deletedItems/{id}/restore` | Restore deleted directory object item |
| POST | `/directory/deletedItems/getUserOwnedObjects` | List deleted items (directory objects) owned by a user |
| POST | `/directoryObjects/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/directoryObjects/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/directoryObjects/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/directoryObjects/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/directoryObjects/getByIds` | directoryObject: getByIds |
| POST | `/groups/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/groups/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/groups/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/groups/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/groups/{id}/onenote/notebooks` | Create notebook |
| POST | `/invitations` | Create invitation |
| POST | `/me/calendar/events` | Create event |
| POST | `/me/calendarGroups` | Create CalendarGroup |
| POST | `/me/changePassword` | user: changePassword |
| POST | `/me/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/me/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/me/contactFolders` | Create ContactFolder |
| POST | `/me/contactFolders/{contactFolderId}/contacts` | Create contact |
| POST | `/me/dataSecurityAndGovernance/activities/contentActivities` | Create contentActivity |
| POST | `/me/dataSecurityAndGovernance/processContent` | userDataSecurityAndGovernance: processContent |
| POST | `/me/dataSecurityAndGovernance/protectionScopes/compute` | userProtectionScopeContainer: compute |
| POST | `/me/getMailTips` | user: getMailTips |
| POST | `/me/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/me/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/me/inferenceClassification/overrides` | Create inferenceClassificationOverride |
| POST | `/me/mailFolders/{id}/messages` | Create message |
| POST | `/me/mailFolders/inbox/messageRules` | Create rule |
| POST | `/me/outlook/masterCategories` | Create Outlook category |
| POST | `/me/revokeSignInSessions` | user: revokeSignInSessions |
| POST | `/me/todo/lists` | Create todoTaskList |
| POST | `/me/translateExchangeIds` | user: translateExchangeIds |
| POST | `/servicePrincipals/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/servicePrincipals/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/servicePrincipals/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/servicePrincipals/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/sites/{id}/onenote/notebooks` | Create notebook |
| POST | `/users` | Create User |
| POST | `/users/{id \| userPrincipalName}/appRoleAssignments` | Grant an appRoleAssignment to a user |
| POST | `/users/{id \| userPrincipalName}/assignLicense` | user: assignLicense |
| POST | `/users/{id \| userPrincipalName}/calendar/events` | Create event |
| POST | `/users/{id\|userPrincipalName}/calendar/getSchedule` | calendar: getSchedule |
| POST | `/users/{id \| userPrincipalName}/calendarGroups` | Create CalendarGroup |
| POST | `/users/{id \| userPrincipalName}/calendars` | Create calendar |
| POST | `/users/{id \| userPrincipalName}/calendars/{id}/events` | Create event |
| POST | `/users/{id \| userPrincipalName}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/users/{id \| userPrincipalName}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/users/{id \| userPrincipalName}/contactFolders` | Create ContactFolder |
| POST | `/users/{id \| userPrincipalName}/contactFolders/{contactFolderId}/contacts` | Create contact |
| POST | `/users/{id \| userPrincipalName}/contacts` | Create contact |
| POST | `/users/{userId}/dataSecurityAndGovernance/activities/contentActivities` | Create contentActivity |
| POST | `/users/{userId}/dataSecurityAndGovernance/processContent` | userDataSecurityAndGovernance: processContent |
| POST | `/users/{usersId}/dataSecurityAndGovernance/protectionScopes/compute` | userProtectionScopeContainer: compute |
| POST | `/users/{id \| userPrincipalName}/events` | Create event |
| POST | `/users/{id}/exportPersonalData` | user: exportPersonalData |
| POST | `/users/{id\|userPrincipalName}/findMeetingTimes` | user: findMeetingTimes |
| POST | `/users/{id\|userPrincipalName}/getMailTips` | user: getMailTips |
| POST | `/users/{id \| userPrincipalName}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/users/{id \| userPrincipalName}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/users/{id}/inferenceClassification/overrides` | Create inferenceClassificationOverride |
| POST | `/users/{id \| userPrincipalName}/mailFolders` | Create MailFolder |
| POST | `/users/{id \| userPrincipalName}/mailFolders/{id}/messages` | Create message |
| POST | `/users/{id \| userPrincipalName}/mailFolders/inbox/messageRules` | Create rule |
| POST | `/users/{id\|userPrincipalName}/messages` | Create message |
| POST | `/users/{id \| userPrincipalName}/onenote/notebooks` | Create notebook |
| POST | `/users/{id\|userPrincipalName}/outlook/masterCategories` | Create Outlook category |
| POST | `/users/{id}/reprocessLicenseAssignment` | user: reprocessLicenseAssignment |
| POST | `/users/{id}/retryServiceProvisioning` | user: retryServiceProvisioning |
| POST | `/users/{id \| userPrincipalName}/revokeSignInSessions` | user: revokeSignInSessions |
| POST | `/users/{id}/sponsors/$ref` | Add sponsor |
| POST | `/users/{user-id \| user-principal-name}/teamwork/installedApps` | Install app for user |
| POST | `/users/{user-id \| user-principal-name}/teamwork/installedApps/{app-installation-id}/upgrade` | teamsAppInstallation in personal scope: upgrade |
| POST | `/users/{id\|userPrincipalName}/todo/lists` | Create todoTaskList |
| POST | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks` | Create todoTask |
| POST | `/users/{id\|userPrincipalName}/translateExchangeIds` | user: translateExchangeIds |
| PUT | `/groups/{id}/photo/$value` | Update profilePhoto |
| PUT | `/me/contactfolders/{contactFolderId}/contacts/{id}/photo/$value` | Update profilePhoto |
| PUT | `/me/contacts/{id}/photo/$value` | Update profilePhoto |
| PUT | `/me/photo/$value` | Update profilePhoto |
| PUT | `/teams/{id}/photo/$value` | Update profilePhoto |
| PUT | `/users/{id \| userPrincipalName}/contactfolders/{contactFolderId}/contacts/{id}/photo/$value` | Update profilePhoto |
| PUT | `/users/{id \| userPrincipalName}/contacts/{id}/photo/$value` | Update profilePhoto |
| PUT | `/users/{id}/manager/$ref` | Assign manager |
| PUT | `/users/{id \| userPrincipalName}/photo/$value` | Update profilePhoto |

### Groups — 183 missing of 196

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/directory/deletedItems/{id}` | Permanently delete an item (directory object) |
| DELETE | `/groupLifecyclePolicies/{id}` | Delete groupLifecyclePolicy |
| DELETE | `/groups/{id}` | Delete group - Microsoft Graph API |
| DELETE | `/groups/{id}/acceptedSenders/$ref?$id=https://graph.microsoft.com/v1.0/groups/{other-group-id}` | Remove acceptedSender |
| DELETE | `/groups/{id}/acceptedSenders/$ref?$id=https://graph.microsoft.com/v1.0/users/{user-id}` | Remove acceptedSender |
| DELETE | `/groups/{id}/appRoleAssignments/{id}` | Delete appRoleAssignment |
| DELETE | `/groups/{id}/calendar/events/{id}` | Delete event |
| DELETE | `/groups/{id}/conversations/{id}` | Delete conversation |
| DELETE | `/groups/{id}/events/{id}` | Delete event |
| DELETE | `/groups/{id}/members/{id}/$ref` | Remove member |
| DELETE | `/groups/{id}/owners/{id}/$ref` | Remove group owner |
| DELETE | `/groups/{id}/photo/$value` | Delete profilePhoto |
| DELETE | `/groups/{id}/rejectedSenders/$ref?$id=https://graph.microsoft.com/v1.0/groups/{other-group-id}` | Remove rejectedSender |
| DELETE | `/groups/{id}/rejectedSenders/$ref?$id=https://graph.microsoft.com/v1.0/users/{user-id}` | Remove rejectedSender |
| DELETE | `/groups/{groupId}/settings/{groupSettingId}` | Delete a group setting |
| DELETE | `/groups/{id}/threads/{id}` | Delete conversation thread |
| DELETE | `/groupSettings/{groupSettingId}` | Delete a group setting |
| DELETE | `/me/photo/$value` | Delete profilePhoto |
| DELETE | `/users/{id \| userPrincipalName}/photo/$value` | Delete profilePhoto |
| GET | `/directory/deletedItems/{object-id}` | Get deleted item (directory object) |
| GET | `/directory/deletedItems/microsoft.graph.administrativeUnit` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.application` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.certificateAuthorityDetail` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.certificateBasedAuthPki` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.group` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.servicePrincipal` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.user` | List deleted items (directory objects) |
| GET | `/drives/{driveId}` | Get drive |
| GET | `/groupLifecyclePolicies` | List groupLifecyclePolicies |
| GET | `/groupLifecyclePolicies/{id}` | Get groupLifecyclePolicy |
| GET | `/groups/{id}/acceptedSenders` | List acceptedSenders |
| GET | `/groups/{id}/appRoleAssignments` | List appRoleAssignments granted to a group |
| GET | `/groups/{id}/calendar` | Get calendar |
| GET | `/groups/{id}/calendar/events` | List events |
| GET | `/groups/{id}/calendar/events/{id}` | Get event |
| GET | `/groups/{id}/calendarView?startDateTime={start_datetime}&endDateTime={end_datetime}` | List group calendarView |
| GET | `/groups/{id}/conversations/{id}` | Get conversation |
| GET | `/groups/{groupId}/conversations/{conversationId}/threads/{threadId}/posts` | List posts |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}` | Get post |
| GET | `/groups/{groupId}/drive` | Get drive |
| GET | `/groups/{group-id}/drive/items/{item-id}/children` | List the contents of a folder |
| GET | `/groups/{id}/events` | List events |
| GET | `/groups/{id}/events/{id}` | Get event |
| GET | `/groups/{id}/groupLifecyclePolicies` | List groupLifecyclePolicies |
| GET | `/groups/{id}/memberOf` | List group memberships |
| GET | `/groups/{id}/onenote/notebooks` | List notebooks |
| GET | `/groups/{group-id}/permissionGrants` | List permissionGrants of a group |
| GET | `/groups/{id}/photo` | Get profilePhoto |
| GET | `/groups/{id}/photo/$value` | Get profilePhoto |
| GET | `/groups/{id}/photos/{size}` | Get profilePhoto |
| GET | `/groups/{group-id}/planner/plans` | List plans |
| GET | `/groups/{id}/rejectedSenders` | List rejectedSenders |
| GET | `/groups/{groupId}/settings` | List settings |
| GET | `/groups/{groupId}/settings/{groupSettingId}` | Get groupSetting |
| GET | `/groups/{id}/threads/{id}` | Get conversation thread |
| GET | `/groups/{groupId}/threads/{threadId}/posts` | List posts |
| GET | `/groups/{id}/threads/{id}/posts/{id}` | Get post |
| GET | `/groups/{id}/transitiveMemberOf` | List group transitive memberOf |
| GET | `/groups/{id}/transitiveMembers` | List group transitive members |
| GET | `/groups/delta` | group: delta |
| GET | `/groupSettings` | List settings |
| GET | `/groupSettings/{groupSettingId}` | Get groupSetting |
| GET | `/groupSettingTemplates` | List groupSettingTemplates |
| GET | `/groupSettingTemplates/{id}` | Get a group setting template |
| GET | `/me/calendar` | Get calendar |
| GET | `/me/calendarGroups/{id}/calendars/{id}` | Get calendar |
| GET | `/me/calendars/{id}` | Get calendar |
| GET | `/me/contactfolders/{contactFolderId}/contacts/{id}/photo` | Get profilePhoto |
| GET | `/me/contactfolders/{contactFolderId}/contacts/{id}/photo/$value` | Get profilePhoto |
| GET | `/me/contacts/{id}/photo` | Get profilePhoto |
| GET | `/me/contacts/{id}/photo/$value` | Get profilePhoto |
| GET | `/me/drive` | Get drive |
| GET | `/me/drive/items/{item-id}/children` | List the contents of a folder |
| GET | `/me/photo` | Get profilePhoto |
| GET | `/me/photos` | Get profilePhoto |
| GET | `/me/photos/{size}` | Get profilePhoto |
| GET | `/sites/{siteId}/drive` | Get drive |
| GET | `/sites/{site-id}/drive/items/{item-id}/children` | List the contents of a folder |
| GET | `/sites/{id}/onenote/notebooks` | List notebooks |
| GET | `/teams/{id}/photo` | Get profilePhoto |
| GET | `/teams/{id}/photo/$value` | Get profilePhoto |
| GET | `/users/{id \| userPrincipalName}/calendar` | Get calendar |
| GET | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}` | Get calendar |
| GET | `/users/{id \| userPrincipalName}/calendars/{id}` | Get calendar |
| GET | `/users/{id \| userPrincipalName}/contactfolders/{contactFolderId}/contacts/{id}/photo` | Get profilePhoto |
| GET | `/users/{id \| userPrincipalName}/contactfolders/{contactFolderId}/contacts/{id}/photo/$value` | Get profilePhoto |
| GET | `/users/{id \| userPrincipalName}/contacts/{id}/photo` | Get profilePhoto |
| GET | `/users/{id \| userPrincipalName}/contacts/{id}/photo/$value` | Get profilePhoto |
| GET | `/users/{user-id \| userPrincipalName}/drive/items/{item-id}/children` | List the contents of a folder |
| GET | `/users/{id \| user-principal-name}/joinedTeams` | List joinedTeams |
| GET | `/users/{id \| userPrincipalName}/onenote/notebooks` | List notebooks |
| GET | `/users/{id \| userPrincipalName}/photo` | Get profilePhoto |
| GET | `/users/{id \| userPrincipalName}/photos/{size}` | Get profilePhoto |
| GET | `/users/{user-id}/teamwork/associatedTeams` | List associatedTeamInfo |
| PATCH | `/groupLifecyclePolicies/{id}` | Update groupLifecyclePolicy |
| PATCH | `/groups(uniqueName='uniqueName')` | Upsert group |
| PATCH | `/groups/{id}` | Update group |
| PATCH | `/groups/{id}/calendar` | Update calendar |
| PATCH | `/groups/{id}/calendar/events/{id}` | Update event |
| PATCH | `/groups/{id}/events/{id}` | Update event |
| PATCH | `/groups/{id}/photo/$value` | Update profilePhoto |
| PATCH | `/groups/{groupId}/settings/{groupSettingId}` | Update groupSetting |
| PATCH | `/groups/{id}/threads/{id}` | Update conversation thread |
| PATCH | `/groupSettings/{groupSettingId}` | Update groupSetting |
| PATCH | `/me/calendar` | Update calendar |
| PATCH | `/me/calendarGroups/{id}/calendars/{id}` | Update calendar |
| PATCH | `/me/contactfolders/{contactFolderId}/contacts/{id}/photo/$value` | Update profilePhoto |
| PATCH | `/me/contacts/{id}/photo/$value` | Update profilePhoto |
| PATCH | `/me/photo/$value` | Update profilePhoto |
| PATCH | `/users/{id \| userPrincipalName}/calendar` | Update calendar |
| PATCH | `/users/{id \| userPrincipalName}/calendarGroups/{id}/calendars/{id}` | Update calendar |
| PATCH | `/users/{id \| userPrincipalName}/calendars/{id}` | Update calendar |
| PATCH | `/users/{id \| userPrincipalName}/contactfolders/{contactFolderId}/contacts/{id}/photo/$value` | Update profilePhoto |
| PATCH | `/users/{id \| userPrincipalName}/contacts/{id}/photo/$value` | Update profilePhoto |
| PATCH | `/users/{id \| userPrincipalName}/photo/$value` | Update profilePhoto |
| POST | `/contacts/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/contacts/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/contacts/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/contacts/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/devices/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/devices/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/devices/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/devices/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/directory/deletedItems/{id}/restore` | Restore deleted directory object item |
| POST | `/directory/deletedItems/getUserOwnedObjects` | List deleted items (directory objects) owned by a user |
| POST | `/directoryObjects/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/directoryObjects/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/directoryObjects/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/directoryObjects/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/groupLifecyclePolicies` | Create groupLifecyclePolicy |
| POST | `/groupLifecyclePolicies/{id}/addGroup` | groupLifecyclePolicy: addGroup |
| POST | `/groupLifecyclePolicies/{id}/removeGroup` | groupLifecyclePolicy: removeGroup |
| POST | `/groups` | Create group |
| POST | `/groups/{id}/acceptedSenders/$ref` | Create acceptedSender |
| POST | `/groups/{id}/addFavorite` | group: addFavorite |
| POST | `/groups/{groupId}/appRoleAssignments` | Grant an appRoleAssignment to a group |
| POST | `/groups/{id}/assignLicense` | group: assignLicense |
| POST | `/groups/{id}/calendar/events` | Create event |
| POST | `/groups/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/groups/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/groups/{id}/conversations` | Create conversation |
| POST | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/forward` | post: forward |
| POST | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/reply` | post: reply |
| POST | `/groups/{id}/events` | Create event |
| POST | `/groups/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/groups/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/groups/{group-id}/members/$ref` | Add members |
| POST | `/groups/{id}/onenote/notebooks` | Create notebook |
| POST | `/groups/{id}/owners/$ref` | Add owners |
| POST | `/groups/{id}/rejectedSenders/$ref` | Create rejectedSender |
| POST | `/groups/{id}/removeFavorite` | group: removeFavorite |
| POST | `/groups/{id}/renew` | group: renew |
| POST | `/groups/{id}/resetUnseenCount` | group: resetUnseenCount |
| POST | `/groups/{id}/settings` | Create settings |
| POST | `/groups/{id}/subscribeByMail` | group: subscribeByMail |
| POST | `/groups/{id}/threads` | Create conversation thread |
| POST | `/groups/{id}/threads/{id}/posts/{id}/forward` | post: forward |
| POST | `/groups/{id}/threads/{id}/posts/{id}/reply` | post: reply |
| POST | `/groups/{id}/unsubscribeByMail` | group: unsubscribeByMail |
| POST | `/groups/{id}/validateProperties` | group: validateProperties |
| POST | `/groupSettings` | Create settings |
| POST | `/me/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/me/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/me/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/me/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/servicePrincipals/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/servicePrincipals/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/servicePrincipals/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/servicePrincipals/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/sites/{id}/onenote/notebooks` | Create notebook |
| POST | `/users/{id \| userPrincipalName}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/users/{id \| userPrincipalName}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/users/{id \| userPrincipalName}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/users/{id \| userPrincipalName}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/users/{id \| userPrincipalName}/onenote/notebooks` | Create notebook |
| PUT | `/groups/{id}/photo/$value` | Update profilePhoto |
| PUT | `/me/contactfolders/{contactFolderId}/contacts/{id}/photo/$value` | Update profilePhoto |
| PUT | `/me/contacts/{id}/photo/$value` | Update profilePhoto |
| PUT | `/me/photo/$value` | Update profilePhoto |
| PUT | `/teams/{id}/photo/$value` | Update profilePhoto |
| PUT | `/users/{id \| userPrincipalName}/contactfolders/{contactFolderId}/contacts/{id}/photo/$value` | Update profilePhoto |
| PUT | `/users/{id \| userPrincipalName}/contacts/{id}/photo/$value` | Update profilePhoto |
| PUT | `/users/{id \| userPrincipalName}/photo/$value` | Update profilePhoto |

### SharePoint Sites & Lists — 159 missing of 166

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/sites/{site-id}/columns/{column-id}` | Delete columnDefinition |
| DELETE | `/sites/{site-id}/contentTypes/{contentType-id}` | Delete contentType |
| DELETE | `/sites/{site-id}/contentTypes/{contentType-id}/columns/{column-id}` | Delete columnDefinition |
| DELETE | `/sites/{site-id}/lists/{list-id}/columns/{column-id}` | Delete columnDefinition |
| DELETE | `/sites/{site-id}/lists/{list-id}/contentTypes/{contentType-id}` | Delete contentType |
| DELETE | `/sites/{site-id}/lists/{list-id}/contentTypes/{contentType-id}/columns/{column-id}` | Delete columnDefinition |
| DELETE | `/sites/{siteId}/lists/{listId}/items/{itemId}/documentSetVersions/{documentSetVersionId}` | Delete documentSetVersion |
| DELETE | `/sites/{site-id}/pages/{page-id}` | Delete baseSitePage |
| DELETE | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections/{horizontal-section-id}` | 'Delete horizontalSection' |
| DELETE | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections/{horizontal-section-id}/columns/{horizontal-section-column-id}/webparts/{webpart-index}` | Delete webPart |
| DELETE | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/verticalSection` | 'Delete verticalSection' |
| DELETE | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/verticalSection/webparts/{webpart-index}` | Delete webPart |
| DELETE | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/webParts/{webpart-id}` | Delete webPart |
| DELETE | `/sites/{sitesId}/permissions/{permissionId}` | Delete permission |
| DELETE | `/sites/{site-id}/termStore/groups/{group-id}` | Delete  group |
| DELETE | `sites/{site-id}/termStore/sets/{set-id}` | Delete set |
| DELETE | `/sites/{site-id}/termStore/sets/{set-id}/terms/{term-id}` | Delete term |
| GET | `/admin/sharepoint/settings` | Get sharepointSettings |
| GET | `/drives/{drive-id}/activities` | List activities |
| GET | `/drives/{drive-id}/items/{item-id}/activities` | List activities |
| GET | `/drives/{drive-id}/items/{item-id}/analytics/allTime` | Get itemAnalytics |
| GET | `/drives/{drive-id}/items/{item-id}/analytics/lastSevenDays` | Get itemAnalytics |
| GET | `/drives/{drive-id}/items/{item-id}/getActivitiesByInterval(startDateTime={startDateTime},endDateTime={endDateTime},interval={interval})` | Get item activity stats by interval |
| GET | `/drives/{driveId}/list/subscriptions/socketIo` | Get websocket endpoint |
| GET | `/drives/{driveId}/root/subscriptions/socketIo` | Get websocket endpoint |
| GET | `/groups/{groupId}/drive/root/subscriptions/socketIo` | Get websocket endpoint |
| GET | `/groups/{group-id}/sites/root` | Get a SharePoint Site |
| GET | `/me/drive/root/subscriptions/socketIo` | Get websocket endpoint |
| GET | `/me/followedSites` | List followed sites |
| GET | `/sites?$filter=siteCollection/root ne null` | List sites |
| GET | `/sites?search={query}` | Search for sites |
| GET | `/sites/{hostname}:/{server-relative-path}` | Get a SharePoint Site |
| GET | `/sites/{site-id}/analytics/allTime` | Get itemAnalytics |
| GET | `/sites/{site-id}/analytics/lastSevenDays` | Get itemAnalytics |
| GET | `/sites/{site-id}/columns` | List columns in a site |
| GET | `/sites/{site-id}/columns/{column-id}` | Get columnDefinition |
| GET | `/sites/{site-id}/contentTypes` | List contentTypes in a site |
| GET | `/sites/{site-id}/contentTypes/{contentType-id}` | Get contentType |
| GET | `/sites/{site-id}/contentTypes/{contentType-id}/columns` | List columnDefinitions in a content type |
| GET | `/sites/{site-id}/contentTypes/{contentType-id}/columns/{column-id}` | Get columnDefinition |
| GET | `/sites/{siteId}/contentTypes/{contentTypeId}/isPublished` | contentType: isPublished |
| GET | `/sites/{siteId}/contentTypes/getCompatibleHubContentTypes` | contentType: getCompatibleHubContentTypes |
| GET | `/sites/{site-id}/getActivitiesByInterval(startDateTime={startDateTime},endDateTime={endDateTime},interval={interval})` | Get item activity stats by interval |
| GET | `/sites/{site-id}/lists/{list-id}?expand=columns,items(expand=fields)` | Get a SharePoint list |
| GET | `/sites/{site-id}/lists/{list-id}/activities` | List activities |
| GET | `/sites/{site-id}/lists/{list-id}/columns` | List columnDefinitions in a list |
| GET | `/sites/{site-id}/lists/{list-id}/columns/{column-id}` | Get columnDefinition |
| GET | `/sites/{site-id}/lists/{list-id}/contentTypes` | List contentTypes in a list |
| GET | `/sites/{site-id}/lists/{list-id}/contentTypes/{contentType-id}` | Get contentType |
| GET | `/sites/{site-id}/lists/{list-id}/contentTypes/{contentType-id}/columns` | List columnDefinitions in a content type |
| GET | `/sites/{site-id}/lists/{list-id}/contentTypes/{contentType-id}/columns/{column-id}` | Get columnDefinition |
| GET | `/sites/{siteId}/lists/{listId}/contentTypes/getCompatibleHubContentTypes` | contentType: getCompatibleHubContentTypes |
| GET | `/sites/{siteId}/lists/{listId}/drive/root/subscriptions/socketIo` | Get websocket endpoint |
| GET | `/sites/{site-id}/lists/{list-id}/items?expand=fields` | List items |
| GET | `/sites/{site-id}/lists/{list-id}/items?expand=fields(select=Column1,Column2)` | List items |
| GET | `/sites/{site-id}/lists/{list-id}/items/{item-id}?expand=fields` | Get listItem |
| GET | `/sites/{site-id}/lists/{list-id}/items/{item-id}?expand=fields(select=Column1,Column2)` | Get listItem |
| GET | `/sites/{site-id}/lists/{list-id}/items/{item-id}/activities` | List activities |
| GET | `/sites/{site-id}/lists/{list-id}/items/{item-id}/analytics/allTime` | Get itemAnalytics |
| GET | `/sites/{site-id}/lists/{list-id}/items/{item-id}/analytics/lastSevenDays` | Get itemAnalytics |
| GET | `/sites/{siteId}/lists/{listId}/items/{itemId}/documentSetVersions` | List documentSetVersions |
| GET | `/sites/{siteId}/lists/{listId}/items/{itemId}/documentSetVersions/{documentSetVersionId}` | Get documentSetVersion |
| GET | `/sites/{site-id}/lists/{list-id}/items/{item-id}/getActivitiesByInterval(startDateTime={startDateTime},endDateTime={endDateTime},interval={interval})` | Get item activity stats by interval |
| GET | `/sites/{siteId}/lists/{listId}/items/delta` | listItem: delta |
| GET | `/sites/{siteId}/lists/{listId}/operations` | List operations on a list |
| GET | `/sites/{siteId}/lists/{listId}/operations/{richLongRunningOperation-ID}` | Get richLongRunningOperation |
| GET | `/sites/{siteId}/operations` | List operations on a site |
| GET | `/sites/{siteId}/operations/{richLongRunningOperation-ID}` | Get richLongRunningOperation |
| GET | `/sites/{site-id}/pages` | List baseSitePages |
| GET | `/sites/{site-id}/pages/{page-id}` | Get baseSitePage |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage` | Get sitePage |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections` | List horizontalSections |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections/{horizontal-section-id}` | 'Get horizontalSection' |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections/{horizontal-section-id}/columns` | 'List horizontalSectionColumns' |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections/{horizontal-section-id}/columns/{horizontal-section-column-id}` | 'Get horizontalSectionColumn' |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections/{horizontal-section-id}/columns/{horizontal-section-column-id}/webparts` | List webparts |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections/{horizontal-section-id}/columns/{horizontal-section-column-id}/webparts/{webpart-index}` | Get webPart |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections/{horizontal-section-id}/columns/{horizontal-section-column-id}/webparts/{webpart-index}/getPositionOfWebPart` | webPart: getPosition |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/verticalSection` | 'Get verticalSection' |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/verticalSection/webparts` | List webparts |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/verticalSection/webparts/{webpart-index}` | Get webPart |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/verticalSection/webparts/{webpart-index}/getPositionOfWebPart` | webPart: getPosition |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitepage/getWebPartsByPosition` | sitePage getWebPartsByPosition |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/webparts` | List webparts |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/webParts/{webpart-id}` | Get webPart |
| GET | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/webParts/{webpart-id}/getPositionOfWebPart` | webPart: getPosition |
| GET | `/sites/{site-id}/pages/microsoft.graph.sitePage` | List SitePage |
| GET | `/sites/{sitesId}/permissions` | List permissions |
| GET | `/sites/{sitesId}/permissions/{permissionId}` | Get permission |
| GET | `/sites/{site-id}/sites` | List subsites for a site |
| GET | `/sites/{site-id}/termStore` | Get store |
| GET | `/sites/{site-id}/termStore/groups` | List termStore groups |
| GET | `/sites/{site-id}/termStore/groups/{group-id}` | Get group |
| GET | `sites/{site-id}/termStore/groups/{group-id}/sets` | List sets |
| GET | `/sites/{site-id}/termStore/groups/{group-id}/sets/{set-id}/terms/{term-id}` | Get term |
| GET | `/sites/{site-id}/termStore/sets/{set-id}` | Get set |
| GET | `/sites/{site-id}/termStore/sets/{set-id}/children` | List children |
| GET | `/sites/{site-id}/termStore/sets/{set-id}/relations` | List relations |
| GET | `/sites/{site-id}/termStore/sets/{set-id}/terms/{term-id}` | Get term |
| GET | `/sites/{site-id}/termStore/sets/{set-id}/terms/{term-id}/children` | List children |
| GET | `/sites/{site-id}/termStore/sets/{set-id}/terms/{term-id}/relations` | List relations |
| GET | `/sites/7f50f45e-714a-4264-9c59-3bf43ea4db8f/pages` | List baseSitePages |
| GET | `/sites/7f50f45e-714a-4264-9c59-3bf43ea4db8f/pages/df69e386-6c58-4df2-afc0-ab6327d5b202//microsoft.graph.sitePage/canvasLayout/horizontalSections/1/columns` | 'List horizontalSectionColumns' |
| GET | `/sites/7f50f45e-714a-4264-9c59-3bf43ea4db8f/pages/df69e386-6c58-4df2-afc0-ab6327d5b202/microsoft.graph.sitePage/canvasLayout/horizontalSections/1/columns/1` | 'Get horizontalSectionColumn' |
| GET | `/sites/7f50f45e-714a-4264-9c59-3bf43ea4db8f/pages/df69e386-6c58-4df2-afc0-ab6327d5b202/microsoft.graph.sitePage/canvasLayout/horizontalSections/1/columns/1?$select=id&$expand=webparts` | 'Get horizontalSectionColumn' |
| GET | `/sites/contoso.sharepoint.com` | Get a SharePoint Site |
| GET | `/sites/delta` | site: delta |
| GET | `/sites/getAllSites` | sites: getAllSites |
| GET | `/sites/root` | Get a SharePoint Site |
| PATCH | `/admin/sharepoint/settings` | Update sharepointSettings |
| PATCH | `/sites/{site-id}/columns/{column-id}` | Update columnDefinition |
| PATCH | `/sites/{site-id}/contentTypes/{contentType-id}` | Update contentType |
| PATCH | `/sites/{site-id}/contentTypes/{contentType-id}/columns/{column-id}` | Update columnDefinition |
| PATCH | `/sites/{site-id}/lists/{list-id}/columns/{column-id}` | Update columnDefinition |
| PATCH | `/sites/{site-id}/lists/{list-id}/contentTypes/{contentType-id}` | Update contentType |
| PATCH | `/sites/{site-id}/lists/{list-id}/contentTypes/{contentType-id}/columns/{column-id}` | Update columnDefinition |
| PATCH | `/sites/{site-id}/lists/{list-id}/items/{item-id}/fields` | Update listItem |
| PATCH | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage` | Update sitePage |
| PATCH | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections/{horizontal-section-id}` | 'Update horizontalSection' |
| PATCH | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections/{horizontal-section-id}/columns/{horizontal-section-column-id}/webparts/{webpart-index}` | Update webPart |
| PATCH | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/verticalSection` | 'Update verticalSection' |
| PATCH | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/verticalSection/webparts/{webpart-index}` | Update webPart |
| PATCH | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/webParts/{webpart-id}` | Update webPart |
| PATCH | `/sites/{sitesId}/permissions/{permissionId}` | Update permission |
| PATCH | `sites/{site-id}/termStore` | Update store |
| PATCH | `/sites/{site-id}/termStore/sets/{set-id}` | Update set |
| PATCH | `/sites/{site-id}/termStore/sets/{set-id}/terms/{term-id}` | Update term |
| PATCH | `/sites/7f50f45e-714a-4264-9c59-3bf43ea4db8f/pages/df69e386-6c58-4df2-afc0-ab6327d5b202/microsoft.graph.sitePage/canvasLayout/verticalSection` | 'Update verticalSection' |
| PATCH | `/sites/7f50f45e-714a-4264-9c59-3bf43ea4db8f/pages/df69e386-6c58-4df2-afc0-ab6327d5b202/microsoft.graph.sitePage/webParts/c867fd9e-4c1e-43ec-a448-9760c9fff589` | Update webPart |
| POST | `/sites/{site-id}/columns` | Create a columnDefinition in a site |
| POST | `/sites/{site-id}/contentTypes` | Create a content type |
| POST | `/sites/{siteId}/contentTypes/{contentTypeId}/associateWithHubSites` | contentType: associateWithHubSites |
| POST | `/sites/{site-id}/contentTypes/{contentType-id}/columns` | Create a columnDefinition in a content type |
| POST | `/sites/{siteId}/contentTypes/{contentTypeId}/copyToDefaultContentLocation` | contentType: copyToDefaultContentLocation |
| POST | `/sites/{siteId}/contentTypes/{contentTypeId}/publish` | contentType: publish |
| POST | `/sites/{siteId}/contentTypes/{contentTypeId}/unpublish` | contentType: unpublish |
| POST | `/sites/{siteId}/contentTypes/addCopyFromContentTypeHub` | contentType: addCopyFromContentTypeHub |
| POST | `/sites/{site-id}/lists` | Create a SharePoint List |
| POST | `/sites/{site-id}/lists/{list-id}/columns` | Create a columnDefinition in a list |
| POST | `/sites/{site-id}/lists/{list-id}/contentTypes/{contentType-id}/columns` | Create a columnDefinition in a content type |
| POST | `/sites/{site-id}/lists/{list-id}/contentTypes/addCopy` | contentType: addCopy |
| POST | `/sites/{siteId}/lists/{listId}/contentTypes/addCopyFromContentTypeHub` | contentType: addCopyFromContentTypeHub |
| POST | `/sites/{siteId}/lists/{listId}/items/{itemId}/documentSetVersions` | Create documentSetVersion |
| POST | `/sites/{siteId}/lists/{listId}/items/{itemId}/documentSetVersions/{documentSetVersionId}/restore` | documentSetVersion: restore |
| POST | `/sites/{site-id}/pages` | Create a new page in a SharePoint site |
| POST | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections` | 'Create horizontalSection' |
| POST | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/horizontalSections/{horizontal-section-id}/columns/{horizontal-section-column-id}/webparts` | 'Create webPart' |
| POST | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/verticalSection/webparts` | 'Create webPart' |
| POST | `/sites/{siteId}/pages/{pageId}/microsoft.graph.sitePage/publish` | sitePage: publish |
| POST | `/sites/{sitesId}/permissions` | Create permission |
| POST | `/sites/{site-id}/termStore/groups` | Create termStore group |
| POST | `/sites/{site-id}/termStore/sets` | Create termStore set |
| POST | `/sites/{site-id}/termStore/sets/{set-id}/children` | Create term |
| POST | `/sites/{site-id}/termStore/sets/{set-id}/terms/{term-id}/children` | Create term |
| POST | `/sites/{site-id}/termStore/sets/{set-id}/terms/{term-id}/relations` | Create relation |
| POST | `/sites/7f50f45e-714a-4264-9c59-3bf43ea4db8f/pages/df69e386-6c58-4df2-afc0-ab6327d5b202//microsoft.graph.sitePage/canvasLayout/verticalSection/webparts` | 'Create webPart' |
| POST | `/users/{id \| userPrincipalName}/followedSites/add` | Follow site |
| POST | `/users/{id \| userPrincipalName}/followedSites/remove` | Unfollow site |
| PUT | `/sites/{site-id}/pages/{page-id}/microsoft.graph.sitePage/canvasLayout/verticalSection` | 'Create verticalSection' |

### Planner / Tasks — 18 missing of 25

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/planner/buckets/{id}` | Delete plannerBucket |
| DELETE | `/planner/plans/{id}` | Delete plannerPlan |
| DELETE | `/planner/tasks/{id}` | Delete plannerTask |
| GET | `/planner/buckets/{id}` | Get plannerBucket |
| GET | `/planner/buckets/{id}/tasks` | List tasks |
| GET | `/planner/plans/{plan-id}/buckets` | List buckets |
| GET | `/planner/plans/{id}/details` | Get plannerPlanDetails |
| GET | `/planner/tasks/{id}/assignedToTaskBoardFormat` | Get plannerAssignedToTaskBoardTaskFormat |
| GET | `/planner/tasks/{id}/bucketTaskBoardFormat` | Get plannerBucketTaskBoardTaskFormat |
| GET | `/planner/tasks/{id}/progressTaskBoardFormat` | Get plannerProgressTaskBoardTaskFormat |
| PATCH | `/planner/buckets/{id}` | Update plannerbucket |
| PATCH | `/planner/plans/{plan-id}` | Update plannerPlan |
| PATCH | `/planner/plans/{id}/details` | Update plannerplandetails |
| PATCH | `/planner/tasks/{id}/assignedToTaskBoardFormat` | Update plannerAssignedToTaskBoardTaskFormat |
| PATCH | `/planner/tasks/{id}/bucketTaskBoardFormat` | Update plannerBucketTaskBoardTaskFormat |
| PATCH | `/planner/tasks/{id}/progressTaskBoardFormat` | Update plannerProgressTaskBoardTaskFormat |
| POST | `/planner/buckets` | Create plannerBucket |
| POST | `/planner/plans` | Create plannerPlan |

### To Do Tasks — 40 missing of 49

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/me/todo/lists/{todoTaskListId}` | Delete todoTaskList |
| DELETE | `/me/todo/lists/{id}/tasks/{id}/attachments/{id}` | Delete taskFileAttachment |
| DELETE | `/me/todo/lists/{todoTaskListId}/tasks/{todoTaskId}/checklistItems/{checklistItemId}` | Delete checklistItem |
| DELETE | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}` | Delete todoTaskList |
| DELETE | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{taskId}` | Delete todoTask |
| DELETE | `/users/{id}/todo/lists/{id}/tasks/{id}/attachments/{id}` | Delete taskFileAttachment |
| DELETE | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{taskId}/linkedResources/{linkedResourcesId}` | Delete linkedResource |
| GET | `/me/todo/lists/{todoTaskListId}` | Get todoTaskList |
| GET | `/me/todo/lists/{todoTaskListId}/tasks/{todoTaskId}/attachments` | List taskFileAttachments |
| GET | `/me/todo/lists/{id}/tasks/{id}/attachments/{id}` | Get taskFileAttachment |
| GET | `/me/todo/lists/{id}/tasks/{id}/attachments/{id}/$value` | Get taskFileAttachment |
| GET | `/me/todo/lists/{todoTaskListId}/tasks/{todoTaskId}/checklistItems` | List checklistItems |
| GET | `/me/todo/lists/{todoTaskListId}/tasks/{todoTaskId}/checklistItems/{checklistItemId}` | Get checklistItem |
| GET | `/me/todo/lists/{todoTaskListId}/tasks/{taskId}/linkedResources/{linkedResourcesId}` | Get linkedResource |
| GET | `/users/{id\|userPrincipalName}/todo/lists` | List lists |
| GET | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}` | Get todoTaskList |
| GET | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks` | List Todo tasks |
| GET | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{taskId}` | Get todoTask |
| GET | `/users/{id}/todo/lists/{id}/tasks/{id}/attachments` | List taskFileAttachments |
| GET | `/users/{id}/todo/lists/{id}/tasks/{id}/attachments/{id}` | Get taskFileAttachment |
| GET | `/users/{id}/todo/lists/{id}/tasks/{id}/attachments/{id}/$value` | Get taskFileAttachment |
| GET | `/users/{id \| userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{todoTaskId}/checklistItems` | List checklistItems |
| GET | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{taskId}/linkedResources` | List linkedResources |
| GET | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{taskId}/linkedResources/{linkedResourcesId}` | Get linkedResource |
| PATCH | `/me/todo/lists/{todoTaskListId}` | Update todoTaskList |
| PATCH | `/me/todo/lists/{todoTaskListId}/tasks/{todoTaskId}/checklistItems/{checklistItemId}` | Update checklistItem |
| PATCH | `/me/todo/lists/{todoTaskListId}/tasks/{taskId}/linkedResources/{linkedResourcesId}` | Update linkedResource |
| PATCH | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks` | Update todoTaskList |
| PATCH | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{taskId}` | Update todoTask |
| PATCH | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{taskId}/linkedResources/{linkedResourcesId}` | Update linkedResource |
| POST | `/me/todo/lists` | Create todoTaskList |
| POST | `/me/todo/lists/{id}/tasks/{id}/attachments` | Create taskFileAttachment |
| POST | `/me/todo/lists/{id}/tasks/{id}/attachments/createUploadSession` | taskFileAttachment: createUploadSession |
| POST | `/me/todo/lists/{todoTaskListId}/tasks/{todoTaskId}/checklistItems` | Create checklistItem |
| POST | `/users/{id\|userPrincipalName}/todo/lists` | Create todoTaskList |
| POST | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks` | Create todoTask |
| POST | `/users/{id}/todo/lists/{id}/tasks/{id}/attachments` | Create taskFileAttachment |
| POST | `/users/{id}/todo/lists/{id}/tasks/{id}/attachments/createUploadSession` | taskFileAttachment: createUploadSession |
| POST | `/users/{id \| userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{todoTaskId}/checklistItems` | Create checklistItem |
| POST | `/users/{id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{taskId}/linkedResources` | Create linkedResource |

### Identity & Access — 809 missing of 809

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/devices(deviceId='{deviceId}')` | Delete device |
| DELETE | `/devices/{id}` | Delete device |
| DELETE | `/devices/{id}/registeredOwners/{id}/$ref` | Delete registeredOwners |
| DELETE | `/devices/{id}/registeredUsers/{id}/$ref` | Delete registeredUsers |
| DELETE | `/directory/administrativeUnits/{id}` | Delete administrativeUnit |
| DELETE | `/directory/administrativeUnits/{id}/members/{id}/$ref` | Remove a member |
| DELETE | `/directory/administrativeUnits/{id}/scopedRoleMembers/{id}` | Remove a scopedRoleMember |
| DELETE | `/directory/deletedItems/{id}` | Permanently delete an item (directory object) |
| DELETE | `directory/federationConfigurations/{samlOrWsFedExternalDomainFederation ID}` | Delete samlOrWsFedExternalDomainFederation |
| DELETE | `/directory/publicKeyInfrastructure/certificateBasedAuthConfigurations/{certificateBasedAuthPkiId}` | Delete certificateBasedAuthPki |
| DELETE | `/directory/publicKeyInfrastructure/certificateBasedAuthConfigurations/{certificateBasedAuthPkiId}/certificateAuthorities/{certificateAuthorityDetailId}` | Delete certificateAuthorityDetail |
| DELETE | `/directoryObjects/{id}` | Delete directoryObject |
| DELETE | `/directoryRoles(roleTemplateId='{roleTemplateId}')/members/{id}/$ref` | Remove directory role member |
| DELETE | `/directoryRoles/{role-id}/members/{id}/$ref` | Remove directory role member |
| DELETE | `/domains/{id}` | Delete domain |
| DELETE | `/domains/{domainsId}/federationConfiguration/{internalDomainFederationId}` | Delete internalDomainFederation |
| DELETE | `/groups/{id}/appRoleAssignments/{id}` | Delete appRoleAssignment |
| DELETE | `/groups/{groupId}/settings/{groupSettingId}` | Delete a group setting |
| DELETE | `/groupSettings/{groupSettingId}` | Delete a group setting |
| DELETE | `/identity/apiConnectors/{identityApiConnectorId}` | Delete identityApiConnector |
| DELETE | `/identity/authenticationEventListeners/{authenticationEventListenerId}` | Delete authenticationEventListener |
| DELETE | `/identity/authenticationEventsFlows/{authenticationEventsFlow-id}` | Delete authenticationEventsFlow |
| DELETE | `/identity/authenticationEventsFlows/{authenticationEventsFlow-id}/conditions/applications/includeApplications/{appId}` | Delete authenticationConditionApplication (from a user flow) |
| DELETE | `/identity/authenticationEventsFlows/{authenticationEventsFlow-id}/microsoft.graph.externalUsersSelfServiceSignUpEventsFlow/onAttributeCollection/microsoft.graph.onAttributeCollectionExternalUsersSelfServiceSignUp/attributes/{attributeId}/$ref` | Remove attribute (from user flow) |
| DELETE | `/identity/authenticationEventsFlows/{authenticationEventsFlow-id}/microsoft.graph.externalUsersSelfServiceSignUpEventsFlow/onAuthenticationMethodLoadStart/microsoft.graph.onAuthenticationMethodLoadStartExternalUsersSelfServiceSignUp/{identityProviders-id}/$ref` | Remove identityProvider (from a user flow) |
| DELETE | `/identity/b2xUserFlows/{id}` | Delete b2xIdentityUserFlow |
| DELETE | `/identity/b2xUserFlows/{id}/identityProviders/{id}/$ref` | Delete identityProvider from b2xIdentityUserFlow |
| DELETE | `/identity/b2xUserFlows/{id}/userAttributeAssignments/{id}` | Delete userAttributeAssignment |
| DELETE | `/identity/conditionalAccess/authenticationContextClassReferences/{id}` | Delete authenticationContextClassReference |
| DELETE | `/identity/conditionalAccess/authenticationStrength/policies/{authenticationStrengthPolicyId}/combinationConfigurations/{authenticationCombinationConfigurationId}` | Delete authenticationCombinationConfiguration |
| DELETE | `/identity/conditionalAccess/namedLocations/{id}` | Delete namedLocation |
| DELETE | `/identity/conditionalAccess/policies/{id}` | Delete conditionalAccessPolicy |
| DELETE | `/identity/customAuthenticationExtensions/{customAuthenticationExtensionId}` | Delete customAuthenticationExtension |
| DELETE | `/identity/identityProviders/{id}` | Delete identityProvider |
| DELETE | `/identity/riskPrevention/fraudProtectionProviders/{id}` | Delete fraudProtectionProviders |
| DELETE | `/identity/riskPrevention/webApplicationFirewallProviders/{webApplicationFirewallProviderId}` | Delete webApplicationFirewallProvider |
| DELETE | `/identity/riskPrevention/webApplicationFirewallVerifications/{webApplicationFirewallVerificationModelId}` | Delete webApplicationFirewallVerificationModel |
| DELETE | `/identity/userFlowAttributes/{id}` | Delete identityUserFlowAttribute |
| DELETE | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}` | Delete accessReviewScheduleDefinition |
| DELETE | `/identityGovernance/entitlementManagement/accessPackages/{accessPackageId}` | Delete accessPackage |
| DELETE | `/identityGovernance/entitlementManagement/accessPackages/{id}/incompatibleAccessPackages/{id}/$ref` | Remove accessPackage from incompatibleAccessPackages |
| DELETE | `/identityGovernance/entitlementManagement/accessPackages/{id}/incompatibleGroups/{id}/$ref` | Remove group from incompatibleGroups |
| DELETE | `/identityGovernance/entitlementManagement/accessPackages/{id}/resourceRoleScopes/{id}` | Remove resourceRoleScope from an access package |
| DELETE | `/identityGovernance/entitlementManagement/assignmentPolicies/{accessPackageAssignmentPolicyId}` | Delete accessPackageAssignmentPolicy |
| DELETE | `/identityGovernance/entitlementManagement/assignmentRequests/{accessPackageAssignmentRequestId}` | Delete accessPackageAssignmentRequest |
| DELETE | `/identityGovernance/entitlementManagement/catalogs/{accessPackageCatalogId}` | Delete accessPackageCatalog |
| DELETE | `/identityGovernance/entitlementManagement/catalogs/{catalogId}/customWorkflowExtensions/{customAccessPackageWorkflowExtensionId}` | Delete accessPackageAssignmentRequestWorkflowExtension |
| DELETE | `/identityGovernance/entitlementManagement/connectedOrganizations/{connectedOrganizationId}` | Delete connectedOrganization |
| DELETE | `/identityGovernance/entitlementManagement/connectedOrganizations/{connectedOrganizationId}/externalSponsors/{id}/$ref` | Remove externalSponsors |
| DELETE | `/identityGovernance/entitlementManagement/connectedOrganizations/{connectedOrganizationId}/internalSponsors/{id}/$ref` | Remove internalSponsors |
| DELETE | `/identityGovernance/lifecycleWorkflows/customTaskExtensions/{customTaskExtensionId}/` | Delete customTaskExtension |
| DELETE | `/identityGovernance/lifecycleWorkflows/deletedItems/workflows/{workflowId}/` | Delete deletedItemContainer (permanently delete a deleted lifecycle workflow) |
| DELETE | `/identityGovernance/lifecycleWorkflows/deletedItems/workflows/{workflowId}/executionScope/{userProcessingResultId}/reprocessedRuns/{id}/$ref` | Remove reprocessedRuns for userProcessingResults |
| DELETE | `/identityGovernance/lifecycleWorkflows/deletedItems/workflows/{workflowId}/executionScope/{userProcessingResultId}/reprocessedRuns/{runId}/reprocessedRuns/{id}/$ref` | Remove reprocessedRuns for a run |
| DELETE | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/` | Delete workflow |
| DELETE | `/identityGovernance/termsOfUse/agreements/{id}` | Delete agreement |
| DELETE | `/identityProviders/{id}` | Delete identityProvider |
| DELETE | `/me/authentication/emailMethods/{emailMethods-id}` | Delete emailAuthenticationMethod |
| DELETE | `/me/authentication/fido2Methods/{id}` | Delete fido2AuthenticationMethod |
| DELETE | `/me/authentication/microsoftAuthenticatorMethods/{microsoftAuthenticatorAuthenticationMethodId}` | Delete microsoftAuthenticatorAuthenticationMethod |
| DELETE | `/me/authentication/phoneMethods/{phoneMethodId}` | Delete phoneAuthenticationMethod |
| DELETE | `/me/authentication/platformCredentialMethods/{platformCredentialAuthenticationMethodId}` | Delete platformCredentialAuthenticationMethod |
| DELETE | `/me/authentication/qrCodePinMethod/standardQRCode` | Delete qrCode |
| DELETE | `/me/authentication/qrCodePinMethod/temporaryQRCode` | Delete qrCode |
| DELETE | `/me/authentication/softwareOathMethods/{id}` | Delete softwareOathAuthenticationMethod |
| DELETE | `/me/authentication/temporaryAccessPassMethods/{id}` | Delete temporaryAccessPassAuthenticationMethod |
| DELETE | `/me/authentication/windowsHelloForBusinessMethods/{windowsHelloForBusinessAuthenticationMethodId}` | Delete windowsHelloForBusinessAuthenticationMethod |
| DELETE | `/oAuth2PermissionGrants/{id}` | Delete oAuth2PermissionGrant (a delegated permission grant) |
| DELETE | `/organization/{organizationId}/branding/localizations/{organizationalBrandingLocalizationId}` | Delete organizationalBrandingLocalization |
| DELETE | `/organization/{id}/certificateBasedAuthConfiguration/{id}` | Delete certificateBasedAuthConfiguration |
| DELETE | `/policies/activityBasedTimeoutPolicies/{id}` | Delete activityBasedTimeoutPolicy |
| DELETE | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/{id}` | Delete externalAuthenticationMethodConfiguration |
| DELETE | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/email` | Delete emailAuthenticationMethodConfiguration |
| DELETE | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/fido2` | Delete fido2AuthenticationMethodConfiguration |
| DELETE | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/microsoftAuthenticator` | Delete microsoftAuthenticatorAuthenticationMethodConfiguration |
| DELETE | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/qrCodePin` | Delete qrCodePinAuthenticationMethodConfiguration |
| DELETE | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/sms` | Delete smsAuthenticationMethodConfiguration |
| DELETE | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/softwareOath` | Delete softwareOathAuthenticationMethodConfiguration |
| DELETE | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/temporaryAccessPass` | Delete temporaryAccessPassAuthenticationMethodConfiguration |
| DELETE | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/voice` | Delete voiceAuthenticationMethodConfiguration |
| DELETE | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/x509Certificate` | Delete x509CertificateAuthenticationMethodConfiguration |
| DELETE | `/policies/authenticationStrengthPolicies/{authenticationStrengthPolicyId}` | Delete authenticationStrengthPolicy |
| DELETE | `/policies/crossTenantAccessPolicy/partners/{id}` | Delete crossTenantAccessPolicyConfigurationPartner |
| DELETE | `/policies/crossTenantAccessPolicy/partners/{id}/identitySynchronization` | Delete crossTenantIdentitySyncPolicyPartner |
| DELETE | `/policies/featureRolloutPolicies/{id}` | Delete featureRolloutPolicy |
| DELETE | `/policies/featureRolloutPolicies/{policyId}/appliesTo/{directoryObjectId}/$ref` | Remove appliesTo on a featureRolloutPolicy |
| DELETE | `/policies/homeRealmDiscoveryPolicies/{id}` | Delete homeRealmDiscoveryPolicy |
| DELETE | `/roleManagement/directory/roleAssignments/{id}` | Delete unifiedRoleAssignment |
| DELETE | `/roleManagement/directory/roleDefinitions/{id}` | Delete unifiedRoleDefinition |
| DELETE | `/roleManagement/entitlementManagement/roleAssignments/{id}` | Delete unifiedRoleAssignment |
| DELETE | `/servicePrincipals(appId='{appId}')/appRoleAssignedTo/{appRoleAssignment-id}` | Delete appRoleAssignedTo |
| DELETE | `/servicePrincipals(appId='{appId}')/appRoleAssignments/{appRoleAssignment-id}` | Delete appRoleAssignment |
| DELETE | `/servicePrincipals(appId='{appId}')/homeRealmDiscoveryPolicies/{id}/$ref` | Remove homeRealmDiscoveryPolicy |
| DELETE | `/servicePrincipals/{id}/appRoleAssignedTo/{appRoleAssignment-id}` | Delete appRoleAssignedTo |
| DELETE | `/servicePrincipals/{servicePrincipal-id}/appRoleAssignments/{appRoleAssignment-id}` | Delete appRoleAssignment |
| DELETE | `/servicePrincipals/{id}/homeRealmDiscoveryPolicies/{id}/$ref` | Remove homeRealmDiscoveryPolicy |
| DELETE | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}` | Delete delegatedAdminRelationship |
| DELETE | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}/accessAssignments/{delegatedAdminAccessAssignmentId}` | Delete delegatedAdminAccessAssignment |
| DELETE | `/tenantRelationships/multiTenantOrganization/tenants/{tenantId}` | Remove multiTenantOrganizationMember |
| DELETE | `/users/{id}/appRoleAssignments/{id}` | Delete appRoleAssignment |
| DELETE | `/users/{usersId}/authentication/externalAuthenticationMethods/{externalAuthenticationMethodId}/$ref` | Delete externalAuthenticationMethod |
| DELETE | `/users/{id \| userPrincipalName}/authentication/fido2Methods/{id}` | Delete fido2AuthenticationMethod |
| DELETE | `/users/{id \| userPrincipalName}/authentication/microsoftAuthenticatorMethods/{microsoftAuthenticatorAuthenticationMethodId}` | Delete microsoftAuthenticatorAuthenticationMethod |
| DELETE | `/users/{id \| userPrincipalName}/authentication/phoneMethods/{phoneMethodId}` | Delete phoneAuthenticationMethod |
| DELETE | `/users/{id \| userPrincipalName}/authentication/platformCredentialMethods/{platformCredentialAuthenticationMethodId}` | Delete platformCredentialAuthenticationMethod |
| DELETE | `/users/{id \| userPrincipalName}/authentication/qrCodePinMethod` | Delete qrCodePinAuthenticationMethod |
| DELETE | `/users/{id}/authentication/qrCodePinMethod/standardQRCode` | Delete qrCode |
| DELETE | `/users/{id}/authentication/qrCodePinMethod/temporaryQRCode` | Delete qrCode |
| DELETE | `/users/{id \| userPrincipalName}/authentication/softwareOathMethods/{id}` | Delete softwareOathAuthenticationMethod |
| DELETE | `/users/{id \| userPrincipalName}/authentication/temporaryAccessPassMethods/{id}` | Delete temporaryAccessPassAuthenticationMethod |
| DELETE | `/users/{id \| userPrincipalName}/authentication/windowsHelloForBusinessMethods/{windowsHelloForBusinessAuthenticationMethodId}` | Delete windowsHelloForBusinessAuthenticationMethod |
| GET | `/agreements/{agreementsId}?$expand=files` | List files (terms of use agreement files) |
| GET | `/agreements/{agreementsId}/file` | Get agreementFile |
| GET | `/agreements/{agreementsId}/file/localizations` | List agreementFileLocalizations |
| GET | `/contacts` | List orgContacts |
| GET | `/contacts/{id}` | Get orgContact |
| GET | `/contacts/{id}/directReports` | List directReports |
| GET | `/contacts/{id}/manager` | Get manager |
| GET | `/contacts/{id}/memberOf` | List memberOf |
| GET | `/contacts/{id}/transitiveMemberOf` | List transitiveMemberOf |
| GET | `/contacts/delta` | orgContact: delta |
| GET | `/contracts` | List contracts |
| GET | `/contracts/{id}` | Get Contract |
| GET | `/dataPolicyOperations/{id}` | Get dataPolicyOperation |
| GET | `/devices` | List devices |
| GET | `/devices(deviceId='{deviceId}')` | Get device |
| GET | `/devices(deviceId='{deviceId}')/memberOf` | List device memberships |
| GET | `/devices(deviceId='{deviceId}')/registeredOwners` | List registeredOwners |
| GET | `/devices(deviceId='{deviceId}')/registeredUsers` | List registeredUsers |
| GET | `/devices(deviceId='{deviceId}')/transitiveMemberOf` | List device transitive memberships |
| GET | `/devices/{id}` | Get device |
| GET | `/devices/{id}/memberOf` | List device memberships |
| GET | `/devices/{id}/registeredOwners` | List registeredOwners |
| GET | `/devices/{id}/registeredUsers` | List registeredUsers |
| GET | `/devices/{id \| userPrincipalName}/transitiveMemberOf` | List device transitive memberships |
| GET | `/devices/delta` | device: delta |
| GET | `/directory/administrativeUnits` | List administrativeUnits |
| GET | `/directory/administrativeUnits/{id}` | Get administrativeUnit |
| GET | `/directory/administrativeUnits/{id}/members` | List members |
| GET | `/directory/administrativeUnits/{id}/members/{id}` | Get a member |
| GET | `/directory/administrativeUnits/{id}/members/$ref` | List members |
| GET | `/directory/administrativeUnits/{id}/scopedRoleMembers` | List scopedRoleMembers |
| GET | `/directory/administrativeUnits/{id}/scopedRoleMembers/{id}` | Get a scopedRoleMember |
| GET | `/directory/attributeSets` | List attributeSets |
| GET | `/directory/attributeSets/{attributeSetId}` | Get attributeSet |
| GET | `/directory/customSecurityAttributeDefinitions` | List customSecurityAttributeDefinitions |
| GET | `/directory/customSecurityAttributeDefinitions/{customSecurityAttributeDefinitionId}` | Get customSecurityAttributeDefinition |
| GET | `/directory/customSecurityAttributeDefinitions/{customSecurityAttributeDefinitionId}/allowedValues` | List allowedValues |
| GET | `/directory/customSecurityAttributeDefinitions/{customSecurityAttributeDefinitionId}/allowedValues/{allowedValueId}` | Get allowedValue |
| GET | `/directory/deletedItems/{object-id}` | Get deleted item (directory object) |
| GET | `/directory/deletedItems/microsoft.graph.administrativeUnit` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.application` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.certificateAuthorityDetail` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.certificateBasedAuthPki` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.group` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.servicePrincipal` | List deleted items (directory objects) |
| GET | `/directory/deletedItems/microsoft.graph.user` | List deleted items (directory objects) |
| GET | `/directory/deviceLocalCredentials` | List deviceLocalCredentialInfo |
| GET | `/directory/deviceLocalCredentials/{deviceId}` | Get deviceLocalCredentialInfo |
| GET | `/directory/federationConfigurations/graph.samlOrWsFedExternalDomainFederation` | List samlOrWsFedExternalDomainFederations |
| GET | `/directory/federationConfigurations/graph.samlOrWsFedExternalDomainFederation?$filter=domains/any(x: x/id eq 'domainName-value')` | Get samlOrWsFedExternalDomainFederation |
| GET | `/directory/federationConfigurations/microsoft.graph.samlOrWsFedExternalDomainFederation/{samlOrWsFedExternalDomainFederation ID}/domains` | List domains |
| GET | `/directory/onPremisesSynchronization` | Get onPremisesDirectorySynchronization |
| GET | `/directory/publicKeyInfrastructure/certificateBasedAuthConfigurations` | List certificateBasedAuthPki objects |
| GET | `/directory/publicKeyInfrastructure/certificateBasedAuthConfigurations/{certificateBasedAuthPkiId}` | Get certificateBasedAuthPki |
| GET | `/directory/publicKeyInfrastructure/certificateBasedAuthConfigurations/{certificateBasedAuthPkiId}/certificateAuthorities` | List certificateAuthorityDetail objects |
| GET | `/directory/publicKeyInfrastructure/certificateBasedAuthConfigurations/{certificateBasedAuthPkiId}/certificateAuthorities/{certificateAuthorityDetailId}` | Get certificateAuthorityDetail |
| GET | `/directory/subscriptions` | List subscriptions |
| GET | `/directory/subscriptions(commerceSubscriptionId='{commerceSubscriptionId}')` | Get companySubscription |
| GET | `/directory/subscriptions/{id}` | Get companySubscription |
| GET | `/directoryObjects/{id}` | Get directoryObject |
| GET | `/directoryObjects/delta?$filter=id eq '{id}'` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.administrativeUnit')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.application')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.appRoleAssignment') or isof('microsoft.graph.user')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.device')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.directoryRole')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.group')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.orgContact')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.servicePrincipal')` | directoryObject: delta |
| GET | `/directoryObjects/delta?$filter=isof('microsoft.graph.user')` | directoryObject: delta |
| GET | `/directoryRoles` | List directoryRoles |
| GET | `/directoryRoles(roleTemplateId='{roleTemplateId}')` | Get directoryRole |
| GET | `/directoryRoles(roleTemplateId='{roleTemplateId}')/members` | List members of a directory role |
| GET | `/directoryRoles(roleTemplateId='{roleTemplateId}')/scopedMembers` | List scopedMembers for a directory role |
| GET | `/directoryRoles/{role-id}` | Get directoryRole |
| GET | `/directoryRoles/{role-id}/members` | List members of a directory role |
| GET | `/directoryroles/{role-id}/scopedMembers` | List scopedMembers for a directory role |
| GET | `/directoryRoles/delta` | directoryRole: delta |
| GET | `/directoryRoleTemplates` | List directoryRoleTemplates |
| GET | `/directoryRoleTemplates/{id}` | Get directoryRoleTemplate |
| GET | `/domains` | List domains |
| GET | `/domains/{id}` | Get domain |
| GET | `/domains/{id}/domainNameReferences` | List domainNameReferences |
| GET | `/domains/{domainsId}/federationConfiguration` | List internalDomainFederations |
| GET | `/domains/{domainsId}/federationConfiguration/{internalDomainFederationId}` | Get internalDomainFederation |
| GET | `/domains/{id}/rootDomain` | Get rootDomain |
| GET | `/domains/{id}/serviceConfigurationRecords` | List serviceConfigurationRecords |
| GET | `/domains/{id}/verificationDnsRecords` | List verificationDnsRecords |
| GET | `/groups/{id}/appRoleAssignments` | List appRoleAssignments granted to a group |
| GET | `/groups/{group-id}/appRoleAssignments/{appRoleAssignment-id}` | Get appRoleAssignment |
| GET | `/groups/{groupId}/settings` | List settings |
| GET | `/groups/{groupId}/settings/{groupSettingId}` | Get groupSetting |
| GET | `/groupSettings` | List settings |
| GET | `/groupSettings/{groupSettingId}` | Get groupSetting |
| GET | `/groupSettingTemplates` | List groupSettingTemplates |
| GET | `/groupSettingTemplates/{id}` | Get a group setting template |
| GET | `/identity/apiConnectors/` | List identityApiConnectors |
| GET | `/identity/apiConnectors/{identityApiConnectorId}` | Get identityApiConnector |
| GET | `/identity/authenticationEventListeners` | List authenticationEventListeners |
| GET | `/identity/authenticationEventListeners/{authenticationEventListenerId}` | Get authenticationEventListener |
| GET | `/identity/authenticationEventsFlows` | List authenticationEventsFlows |
| GET | `/identity/authenticationEventsFlows/{authenticationEventsFlow-id}` | Get authenticationEventsFlow |
| GET | `/identity/authenticationEventsFlows/{authenticationEventsFlow-id}/conditions/applications/includeApplications/` | List includeApplications (for a user flow) |
| GET | `/identity/authenticationEventsFlows/{authenticationEventsFlow-id}/microsoft.graph.externalUsersSelfServiceSignUpEventsFlow/onAttributeCollection/microsoft.graph.onAttributeCollectionExternalUsersSelfServiceSignUp/attributes/` | List attributes (of a user flow) |
| GET | `/identity/authenticationEventsFlows/{authenticationEventsFlow-id}/microsoft.graph.externalUsersSelfServiceSignUpEventsFlow/onAuthenticationMethodLoadStart/microsoft.graph.onAuthenticationMethodLoadStartExternalUsersSelfServiceSignUp/identityProviders/` | List identityProviders (in a user flow) |
| GET | `/identity/b2xUserFlows` | List b2xIdentityUserFlows |
| GET | `/identity/b2xUserFlows/{id}` | Get b2xIdentityUserFlow |
| GET | `/identity/b2xUserFlows/{id}/identityProviders` | List identityProviders |
| GET | `/identity/b2xUserFlows/{id}/languages` | List languages |
| GET | `identity/b2xUserFlows/{id}/languages/{id}` | Get userFlowLanguageConfiguration |
| GET | `/identity/b2xUserFlows/{id}/languages/{id}/defaultPages` | List defaultPages |
| GET | `/identity/b2xUserFlows/{id}/languages/{id}/overridesPages` | List overridesPages |
| GET | `/identity/b2xUserFlows/{id}/userAttributeAssignments` | List userAttributeAssignments |
| GET | `/identity/b2xUserFlows/{id}/userAttributeAssignments/{id}` | Get userAttributeAssignments |
| GET | `/identity/b2xUserFlows/{b2xIdentityUserFlowId}/userAttributeAssignments/getOrder` | identityUserFlowAttributeAssignment: getOrder |
| GET | `/identity/conditionalAccess/authenticationContextClassReferences` | List authenticationContextClassReferences |
| GET | `/identity/conditionalAccess/authenticationContextClassReferences/{id}` | Get authenticationContextClassReference |
| GET | `/identity/conditionalAccess/authenticationStrength/authenticationMethodModes` | List authenticationMethodModes |
| GET | `/identity/conditionalAccess/authenticationStrength/authenticationMethodModes/{authenticationMethodModeDetailId}` | Get authenticationMethodModeDetail |
| GET | `/identity/conditionalAccess/authenticationStrength/combinations` | List authenticationMethodModes |
| GET | `/identity/conditionalAccess/authenticationStrength/policies/{authenticationStrengthPolicyId}/combinationConfigurations` | List combinationConfigurations |
| GET | `/identity/conditionalAccess/authenticationStrength/policies/{authenticationStrengthPolicyId}/combinationConfigurations/{authenticationCombinationConfigurationId}` | Get authenticationCombinationConfiguration |
| GET | `/identity/conditionalAccess/namedLocations` | List namedLocations |
| GET | `/identity/conditionalAccess/namedLocations/{id}` | Get namedLocation |
| GET | `/identity/conditionalAccess/policies` | List policies |
| GET | `/identity/conditionalAccess/policies/{id}` | Get conditionalAccessPolicy |
| GET | `/identity/conditionalAccess/templates` | List conditionalAccessTemplates |
| GET | `/identity/conditionalAccess/templates/{id}` | Get template |
| GET | `/identity/customAuthenticationExtensions` | List customAuthenticationExtensions |
| GET | `/identity/customAuthenticationExtensions/{customAuthenticationExtensionId}` | Get customAuthenticationExtension |
| GET | `/identity/identityProviders` | List identityProviders |
| GET | `/identity/identityProviders/{id}` | Get identityProvider |
| GET | `/identity/identityProviders/availableProviderTypes` | List availableProviderTypes |
| GET | `/identity/riskPrevention/fraudProtectionProviders` | List fraudProtectionProviders |
| GET | `/identity/riskPrevention/fraudProtectionProviders/{fraudProtectionProviderId}` | Get fraudProtectionProvider |
| GET | `/identity/riskPrevention/webApplicationFirewallProviders` | List webApplicationFirewallProvider objects |
| GET | `/identity/riskPrevention/webApplicationFirewallProviders/{webApplicationFirewallProviderId}` | Get webApplicationFirewallProvider |
| GET | `/identity/riskPrevention/webApplicationFirewallVerifications` | List webApplicationFirewallVerificationModel objects |
| GET | `/identity/riskPrevention/webApplicationFirewallVerifications/{webApplicationFirewallVerificationModelId}` | Get webApplicationFirewallVerificationModel |
| GET | `/identity/userFlowAttributes` | List identityUserFlowAttributes |
| GET | `/identity/userFlowAttributes/{id}` | Get identityUserFlowAttribute |
| GET | `/identityGovernance/accessReviews/definitions` | List definitions |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}` | Get accessReviewScheduleDefinition |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances` | List instances |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}` | Get accessReviewInstance |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/contactedReviewers` | List contactedReviewers |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/decisions` | List decisions |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/decisions/{accessReviewInstanceDecisionItemId}` | Get accessReviewInstanceDecisionItem |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/decisions/filterByCurrentUser(on='reviewer')` | accessReviewInstanceDecisionItem: filterByCurrentUser |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/stages` | List stages (of an access review) |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/stages/{accessReviewStageId}` | Get accessReviewStage |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/stages/{accessReviewStageId}/decisions` | List decisions (from a multi-stage access review) |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/stages/{accessReviewStageId}/decisions/{accessReviewInstanceDecisionItemId}` | Get accessReviewInstanceDecisionItem |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/stages/{accessReviewStageId}/decisions/filterByCurrentUser(on='reviewer')` | accessReviewInstanceDecisionItem: filterByCurrentUser |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/stages/filterByCurrentUser(on='reviewer')` | accessReviewStage: filterByCurrentUser |
| GET | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/filterByCurrentUser(on='reviewer')` | accessReviewInstance: filterByCurrentUser |
| GET | `/identityGovernance/accessReviews/definitions/filterByCurrentUser(on='reviewer')` | accessReviewScheduleDefinition: filterByCurrentUser |
| GET | `/identityGovernance/accessReviews/historyDefinitions` | List historyDefinitions |
| GET | `/identityGovernance/accessReviews/historyDefinitions/{definition-id}` | Get accessReviewHistoryDefinition |
| GET | `/identityGovernance/accessReviews/historyDefinitions/{accessReviewHistoryDefinitionId}/instances` | List instances (of an accessReviewHistoryDefinition) |
| GET | `/identityGovernance/appConsent/appConsentRequests` | List appConsentRequests |
| GET | `/identityGovernance/appConsent/appConsentRequests/{id}` | Get appConsentRequest |
| GET | `/identityGovernance/appConsent/appConsentRequests/{id}/userConsentRequests` | List userConsentRequests |
| GET | `/identityGovernance/appConsent/appConsentRequests/{appconsentrequest-id}/userConsentRequests/{userconsentrequest-id}` | Get userConsentRequest |
| GET | `/identityGovernance/appConsent/appConsentRequests/{id}/userConsentRequests/filterByCurrentUser(on='parameterValue')` | userConsentRequest: filterByCurrentUser |
| GET | `/identityGovernance/appConsent/appConsentRequests/filterByCurrentUser(on='parameterValue')` | appConsentRequest: filterByCurrentUser |
| GET | `/identityGovernance/entitlementManagement/accessPackageAssignmentApprovals/{accessPackageAssignmentRequestId}` | Get approval |
| GET | `/identityGovernance/entitlementManagement/accessPackageAssignmentApprovals/{accessPackageAssignmentRequestId}/stages` | List approval stages |
| GET | `/identityGovernance/entitlementManagement/accessPackageAssignmentApprovals/{accessPackageAssignmentRequestId}/stages/{approvalStageId}` | Get approvalStage |
| GET | `/identityGovernance/entitlementManagement/accessPackageAssignmentApprovals/filterByCurrentUser(on='approver')` | approval: filterByCurrentUser |
| GET | `/identityGovernance/entitlementManagement/accessPackages` | List accessPackages |
| GET | `/identityGovernance/entitlementManagement/accessPackages/{accessPackageId}` | Get accessPackage |
| GET | `/identityGovernance/entitlementManagement/accessPackages/{id}?$expand=resourceRoleScopes($expand=role,scope)` | List resourceRoleScopes |
| GET | `/identityGovernance/entitlementManagement/accessPackages/{id}/accessPackagesIncompatibleWith` | List accessPackagesIncompatibleWith |
| GET | `/identityGovernance/entitlementManagement/accessPackages/{id}/incompatibleAccessPackages` | List incompatibleAccessPackages |
| GET | `/identityGovernance/entitlementManagement/accessPackages/{id}/incompatibleGroups` | List incompatibleGroups |
| GET | `/identityGovernance/entitlementManagement/accessPackages/filterByCurrentUser(on='allowedRequestor')` | accessPackage: filterByCurrentUser |
| GET | `/identityGovernance/entitlementManagement/assignmentPolicies` | List assignmentPolicies |
| GET | `/identityGovernance/entitlementManagement/assignmentPolicies/{accessPackageAssignmentPolicyId}` | Get accessPackageAssignmentPolicy |
| GET | `/identityGovernance/entitlementManagement/assignmentRequests` | List assignmentRequests |
| GET | `/identityGovernance/entitlementManagement/assignmentRequests/{accessPackageAssignmentRequestId}` | Get accessPackageAssignmentRequest |
| GET | `/identityGovernance/entitlementManagement/assignmentRequests/filterByCurrentUser(on='parameterValue')` | accessPackageAssignmentRequest: filterByCurrentUser |
| GET | `/identityGovernance/entitlementManagement/assignments` | List accessPackageAssignments |
| GET | `/identityGovernance/entitlementManagement/assignments/{accessPackageAssignmentId}` | Get accessPackageAssignment |
| GET | `/identityGovernance/entitlementManagement/assignments/additionalAccess(accessPackageId='parameterValue',incompatibleAccessPackageId='parameterValue')` | accessPackageAssignment: additionalAccess |
| GET | `/identityGovernance/entitlementManagement/assignments/filterByCurrentUser(on='parameterValue')` | accessPackageAssignment: filterByCurrentUser |
| GET | `/identityGovernance/entitlementManagement/catalogs` | List accessPackageCatalogs |
| GET | `/identityGovernance/entitlementManagement/catalogs/{accessPackageCatalogId}` | Get accessPackageCatalog |
| GET | `/identityGovernance/entitlementManagement/catalogs/{catalogId}/customWorkflowExtensions` | List accessPackagecustomWorkflowExtensions |
| GET | `/identityGovernance/entitlementManagement/catalogs/{catalogId}/customWorkflowExtensions/{accessPackageCustomWorkflowExtensionId}` | Get accessPackageAssignmentRequestWorkflowExtension |
| GET | `/identityGovernance/entitlementManagement/catalogs/{catalogId}/resourceRoles?$filter=(originSystem+eq+%27{originSystemType}%27+and+resource/id+eq+%27{resourceId}%27)&$expand=resource` | List resourceRoles |
| GET | `/identityGovernance/entitlementManagement/catalogs/{id}/resources` | List resources |
| GET | `/identityGovernance/entitlementManagement/connectedOrganizations` | List connectedOrganizations |
| GET | `/identityGovernance/entitlementManagement/connectedOrganizations/{connectedOrganizationId}` | Get connectedOrganization |
| GET | `/identityGovernance/entitlementManagement/connectedOrganizations/{id}/externalSponsors` | List externalSponsors |
| GET | `/identityGovernance/entitlementManagement/connectedOrganizations/{id}/internalSponsors` | List internalSponsors |
| GET | `/identityGovernance/entitlementManagement/resourceRequests` | List accessPackageResourceRequests |
| GET | `/identityGovernance/entitlementManagement/settings` | Get entitlementManagementSettings |
| GET | `/identityGovernance/lifecycleWorkflows/customTaskExtensions` | List customTaskExtensions |
| GET | `/identityGovernance/lifecycleWorkflows/customTaskExtensions/{customTaskExtensionId}` | Get customTaskExtension |
| GET | `/identityGovernance/lifecycleWorkflows/deletedItems/workflows/` | List deletedItems (deleted lifecycle workflows) |
| GET | `/identityGovernance/lifecycleWorkflows/deletedItems/workflows/{workflowId}/` | Get deletedItemContainer (a deleted lifecycle workflow) |
| GET | `/identityGovernance/lifecycleWorkflows/deletedItems/workflows/{workflowId}/executionScope/{userProcessingResultId}/reprocessedRuns` | List reprocessedRuns for userProcessingResults |
| GET | `/identityGovernance/lifecycleWorkflows/deletedItems/workflows/{workflowId}/executionScope/{userProcessingResultId}/reprocessedRuns/{runId}/reprocessedRuns` | List reprocessedRuns for a run |
| GET | `/identityGovernance/lifecycleWorkflows/insights/topTasksProcessedSummary(startDateTime={startDateTime},endDateTime={endDateTime})` | insights: topTasksProcessedSummary |
| GET | `/identityGovernance/lifecycleWorkflows/insights/topWorkflowsProcessedSummary(startDateTime={startDateTime},endDateTime={endDateTime})` | insights: topWorkflowsProcessedSummary |
| GET | `/identityGovernance/lifecycleWorkflows/insights/workflowsProcessedByCategory(startDateTime={startDateTime},endDateTime={endDateTime})` | insights: workflowsProcessedByCategory |
| GET | `/identityGovernance/lifecycleWorkflows/insights/workflowsProcessedSummary(startDateTime={startDateTime},endDateTime={endDateTime})` | insights: workflowsProcessedSummary |
| GET | `/identityGovernance/lifecycleWorkflows/settings` | Get lifecycleManagementSettings |
| GET | `/identityGovernance/lifecycleWorkflows/taskDefinitions` | List taskDefinitions |
| GET | `/identityGovernance/lifecycleWorkflows/taskDefinitions/{taskDefinitionId}` | Get taskDefinition |
| GET | `/identityGovernance/lifecycleWorkflows/workflows` | List workflows |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}` | Get workflow |
| GET | `/identitygovernance/lifecycleWorkflows/workflows/{workflowId}/executionScope` | List executionScope |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/runs/` | List runs |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/runs/{runId}` | Get run |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/runs/{runId}/taskProcessingResults` | List taskProcessingResults |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflow_id}/runs/{runId}/userProcessingResults/{userProcessingResultId}` | Get userProcessingResult |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/runs/{runId}/userProcessingResults/{userProcessingResultId}/taskProcessingResults` | List taskProcessingResults |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/runs/summary(startDateTime={timestamp},endDateTime={timestamp})` | run: summary |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/taskReports` | List taskReports |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/taskReports/{taskReportId}/taskProcessingResults` | List taskProcessingResult |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/taskReports/summary(startDateTime={timestamp},endDateTime={timestamp})` | taskReport: summary |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/tasks` | List tasks (in Lifecycle Workflows) |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/tasks/{taskId}` | Get task |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflow-id}/userProcessingResults` | List userProcessingResults |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/userProcessingResults/{userProcessingResultId}/taskProcessingResults` | List taskProcessingResults |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/userProcessingResults/summary(startDateTime={TimeStamp},endDateTime={TimeStamp})` | userProcessingResult: summary |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/versions` | List workflowVersions |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/versions/{workflowVersion-versionNumber}` | Get workflowVersion |
| GET | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/versions/{workflowVersion-versionNumber}/tasks` | List tasks (in a workflowVersion) |
| GET | `/identityGovernance/lifecycleWorkflows/workflowTemplates` | List workflowTemplates |
| GET | `/identityGovernance/lifecycleWorkflows/workflowTemplates/{workflowTemplateId}` | Get workflowTemplate |
| GET | `/identityGovernance/privilegedAccess/group/assignmentApprovals/{privilegedaccessgroupassignmentschedulerequestId}` | Get approval |
| GET | `/identityGovernance/privilegedAccess/group/assignmentApprovals/{privilegedaccessgroupassignmentschedulerequestId}/stages` | List approval stages |
| GET | `/identityGovernance/privilegedAccess/group/assignmentApprovals/{privilegedaccessgroupassignmentschedulerequestId}/stages/{approvalStageId}` | Get approvalStage |
| GET | `/identityGovernance/privilegedAccess/group/assignmentApprovals/filterByCurrentUser(on='approver')` | approval: filterByCurrentUser |
| GET | `/identityGovernance/privilegedAccess/group/assignmentScheduleInstances?$filter=groupId eq '{groupId}'` | List assignmentScheduleInstances |
| GET | `/identityGovernance/privilegedAccess/group/assignmentScheduleInstances?$filter=principalId eq '{principalId}'` | List assignmentScheduleInstances |
| GET | `/identityGovernance/privilegedAccess/group/assignmentScheduleInstances/{privilegedAccessGroupAssignmentScheduleInstanceId}` | Get privilegedAccessGroupAssignmentScheduleInstance |
| GET | `/identityGovernance/privilegedAccess/group/assignmentScheduleInstances/filterByCurrentUser(on=parameterValue)` | privilegedAccessGroupAssignmentScheduleInstance: filterByCurrentUser |
| GET | `/identityGovernance/privilegedAccess/group/assignmentScheduleRequests?$filter=groupId eq '{groupId}'` | List assignmentScheduleRequests |
| GET | `/identityGovernance/privilegedAccess/group/assignmentScheduleRequests?$filter=principalId eq '{principalId}'` | List assignmentScheduleRequests |
| GET | `/identityGovernance/privilegedAccess/group/assignmentScheduleRequests/{privilegedAccessGroupAssignmentScheduleRequestId}` | Get privilegedAccessGroupAssignmentScheduleRequest |
| GET | `/identityGovernance/privilegedAccess/group/assignmentScheduleRequests/filterByCurrentUser(on='parameterValue')` | privilegedAccessGroupAssignmentScheduleRequest: filterByCurrentUser |
| GET | `/identityGovernance/privilegedAccess/group/assignmentSchedules?$filter=groupId eq '{groupId}'` | List assignmentSchedules |
| GET | `/identityGovernance/privilegedAccess/group/assignmentSchedules?$filter=principalId eq '{principalId}'` | List assignmentSchedules |
| GET | `/identityGovernance/privilegedAccess/group/assignmentSchedules/{privilegedAccessGroupAssignmentScheduleId}` | Get privilegedAccessGroupAssignmentSchedule |
| GET | `/identityGovernance/privilegedAccess/group/assignmentSchedules/filterByCurrentUser(on='parameterValue')` | privilegedAccessGroupAssignmentSchedule: filterByCurrentUser |
| GET | `/identityGovernance/privilegedAccess/group/eligibilityScheduleInstances?$filter=groupId eq '{groupId}'` | List eligibilityScheduleInstances |
| GET | `/identityGovernance/privilegedAccess/group/eligibilityScheduleInstances?filter=principalId eq '{principalId}'` | List eligibilityScheduleInstances |
| GET | `/identityGovernance/privilegedAccess/group/eligibilityScheduleInstances/{privilegedAccessGroupEligibilityScheduleInstanceId}` | Get privilegedAccessGroupEligibilityScheduleInstance |
| GET | `/identityGovernance/privilegedAccess/group/eligibilityScheduleInstances/filterByCurrentUser(on='parameterValue')` | privilegedAccessGroupEligibilityScheduleInstance: filterByCurrentUser |
| GET | `/identityGovernance/privilegedAccess/group/eligibilityScheduleRequests?$filter=groupId eq '{groupId}'` | List eligibilityScheduleRequests |
| GET | `/identityGovernance/privilegedAccess/group/eligibilityScheduleRequests?$filter=principalId eq '{principalId}'` | List eligibilityScheduleRequests |
| GET | `/identityGovernance/privilegedAccess/group/eligibilityScheduleRequests/{privilegedAccessGroupEligibilityScheduleRequestId}` | Get privilegedAccessGroupEligibilityScheduleRequest |
| GET | `/identityGovernance/privilegedAccess/group/eligibilityScheduleRequests/filterByCurrentUser(on='parameterValue')` | privilegedAccessGroupEligibilityScheduleRequest: filterByCurrentUser |
| GET | `/identityGovernance/privilegedAccess/group/eligibilitySchedules?$filter=groupId eq '{groupId}'` | List eligibilitySchedules |
| GET | `/identityGovernance/privilegedAccess/group/eligibilitySchedules?filter=principalId eq '{principalId}'` | List eligibilitySchedules |
| GET | `/identityGovernance/privilegedAccess/group/eligibilitySchedules/{privilegedAccessGroupEligibilityScheduleId}` | Get privilegedAccessGroupEligibilitySchedule |
| GET | `/identityGovernance/privilegedAccess/group/eligibilitySchedules/filterByCurrentUser(on='parameterValue')` | privilegedAccessGroupEligibilitySchedule: filterByCurrentUser |
| GET | `/identityGovernance/termsOfUse/agreements` | List agreements |
| GET | `/identityGovernance/termsOfUse/agreements/{id}` | Get agreement |
| GET | `/identityGovernance/termsOfUse/agreements/{agreementsId}/acceptances` | List acceptances |
| GET | `/identityProtection/riskDetections` | List riskDetections |
| GET | `/identityProtection/riskDetections/{riskDetectionId}` | Get riskDetection |
| GET | `/identityProtection/riskyServicePrincipals` | List riskyServicePrincipals |
| GET | `/identityProtection/riskyServicePrincipals/{riskyServicePrincipalId}` | Get riskyServicePrincipal |
| GET | `/identityProtection/riskyServicePrincipals/{riskyServicePrincipalId}/history` | List history (risk history of riskyServicePrincipal) |
| GET | `/identityProtection/riskyUsers` | List riskyUsers |
| GET | `/identityProtection/riskyUsers/{riskyUserId}` | Get riskyUser |
| GET | `/identityProtection/riskyUsers/{riskyUserId}/history` | List history of riskyUser |
| GET | `/identityProtection/servicePrincipalRiskDetections` | List servicePrincipalRiskDetections |
| GET | `/identityProtection/servicePrincipalRiskDetections/{servicePrincipalRiskDetectionId}` | Get servicePrincipalRiskDetection |
| GET | `/identityProviders` | List identityProviders |
| GET | `/identityProviders/{id}` | Get identityProvider |
| GET | `/informationProtection/bitlocker/recoveryKeys` | List recoveryKeys |
| GET | `/informationProtection/bitlocker/recoveryKeys/{bitlockeryRecoveryKeyId}` | Get bitlockerRecoveryKey |
| GET | `/informationProtection/bitlocker/recoveryKeys/{bitlockeryRecoveryKeyId}?$select=key` | Get bitlockerRecoveryKey |
| GET | `/me/agreementAcceptances` | List agreementAcceptances |
| GET | `/me/appRoleAssignments` | List appRoleAssignments granted to a user |
| GET | `/me/appRoleAssignments/{appRoleAssignment-id}` | Get appRoleAssignment |
| GET | `/me/authentication/emailMethods` | List emailMethods |
| GET | `/me/authentication/emailMethods/{emailMethods-id}` | Get emailAuthenticationMethod |
| GET | `/me/authentication/externalAuthenticationMethods` | List externalAuthenticationMethod objects |
| GET | `/me/authentication/externalAuthenticationMethods/{externalAuthenticationMethodId}` | Get externalAuthenticationMethod |
| GET | `/me/authentication/fido2Methods` | List fido2AuthenticationMethod |
| GET | `/me/authentication/fido2Methods/{id}` | Get fido2AuthenticationMethod |
| GET | `/me/authentication/methods` | List methods |
| GET | `/me/authentication/microsoftAuthenticatorMethods` | List microsoftAuthenticatorAuthenticationMethods |
| GET | `/me/authentication/microsoftAuthenticatorMethods/{microsoftAuthenticatorAuthenticationMethodId}` | Get microsoftAuthenticatorAuthenticationMethod |
| GET | `/me/authentication/passwordMethods` | List passwordMethods |
| GET | `/me/authentication/passwordMethods/{passwordMethods-id}` | Get passwordAuthenticationMethod |
| GET | `/me/authentication/phoneMethods` | List phoneMethods |
| GET | `/me/authentication/phoneMethods/{phoneMethodId}` | Get phoneAuthenticationMethod |
| GET | `/me/authentication/platformCredentialMethods` | List platformCredentialAuthenticationMethods |
| GET | `/me/authentication/platformCredentialMethods/{platformCredentialAuthenticationMethodId}` | Get platformCredentialAuthenticationMethod |
| GET | `/me/authentication/qrCodePinMethod/standardQRCode` | Get qrCode |
| GET | `/me/authentication/qrCodePinMethod/temporaryQRCode` | Get qrCode |
| GET | `/me/authentication/softwareOathMethods` | List softwareOathMethods |
| GET | `/me/authentication/softwareOathMethods/{id}` | Get softwareOathAuthenticationMethod |
| GET | `/me/authentication/temporaryAccessPassMethods` | List temporaryAccessPassMethods |
| GET | `/me/authentication/temporaryAccessPassMethods/{temporaryAccessPassAuthenticationMethodId}` | Get temporaryAccessPassAuthenticationMethod |
| GET | `/me/authentication/windowsHelloForBusinessMethods` | List windowsHelloForBusinessAuthenticationMethods |
| GET | `/me/authentication/windowsHelloForBusinessMethods/{windowsHelloForBusinessAuthenticationMethodId}` | Get windowsHelloForBusinessAuthenticationMethod |
| GET | `/oauth2PermissionGrants` | List oAuth2PermissionGrants (delegated permission grants) |
| GET | `/oauth2PermissionGrants/{id}` | Get oAuth2PermissionGrant (a delegated permission grant) |
| GET | `/oauth2PermissionGrants/delta` | oauth2permissiongrant: delta |
| GET | `/organization` | List organizations |
| GET | `/organization/{organizationId}` | Get organization |
| GET | `/organization/{organizationId}/branding` | Get organizationalBranding |
| GET | `/organization/{organizationId}/branding/localizations` | List localizations |
| GET | `/organization/{organizationId}/branding/localizations/{organizationalBrandingLocalizationId}` | Get organizationalBrandingLocalization |
| GET | `/organization/{id}/certificateBasedAuthConfiguration` | List certificateBasedAuthConfigurations |
| GET | `/organization/{id}/certificateBasedAuthConfiguration/{id}` | Get certificateBasedAuthConfiguration |
| GET | `/policies/activityBasedTimeoutPolicies` | List activityBasedTimeoutPolicies |
| GET | `/policies/activityBasedTimeoutPolicies/{id}` | Get activityBasedTimeoutPolicy |
| GET | `/policies/adminConsentRequestPolicy` | Get adminConsentRequestPolicy |
| GET | `/policies/authenticationFlowsPolicy` | Get authenticationFlowsPolicy |
| GET | `/policies/authenticationMethodsPolicy` | Get authenticationMethodsPolicy |
| GET | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/{id}` | Get externalAuthenticationMethodConfiguration |
| GET | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/email` | Get emailAuthenticationMethodConfiguration |
| GET | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/fido2` | Get fido2AuthenticationMethodConfiguration |
| GET | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/microsoftAuthenticator` | Get microsoftAuthenticatorAuthenticationMethodConfiguration |
| GET | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/qrCodePin` | Get qrCodePinAuthenticationMethodConfiguration |
| GET | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/sms` | Get smsAuthenticationMethodConfiguration |
| GET | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/softwareOath` | Get softwareOathAuthenticationMethodConfiguration |
| GET | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/temporaryAccessPass` | Get temporaryAccessPassAuthenticationMethodConfiguration |
| GET | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/voice` | Get voiceAuthenticationMethodConfiguration |
| GET | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/x509Certificate` | Get x509CertificateAuthenticationMethodConfiguration |
| GET | `/policies/authenticationStrengthPolicies` | List authenticationStrengthPolicies |
| GET | `/policies/authenticationStrengthPolicies/{authenticationStrengthPolicyId}` | Get authenticationStrengthPolicy |
| GET | `/policies/authenticationStrengthPolicies/{authenticationStrengthPolicyId}/usage` | authenticationStrengthPolicy: usage |
| GET | `/policies/authorizationPolicy` | Get authorizationPolicy |
| GET | `/policies/crossTenantAccessPolicy` | Get crossTenantAccessPolicy |
| GET | `/policies/crossTenantAccessPolicy/default` | Get crossTenantAccessPolicyConfigurationDefault |
| GET | `/policies/crossTenantAccessPolicy/partners` | List partners |
| GET | `/policies/crossTenantAccessPolicy/partners/{id}` | Get crossTenantAccessPolicyConfigurationPartner |
| GET | `/policies/crossTenantAccessPolicy/partners/{id}/identitySynchronization` | Get crossTenantIdentitySyncPolicyPartner |
| GET | `/policies/crossTenantAccessPolicy/templates/multiTenantOrganizationIdentitySynchronization` | Get multiTenantOrganizationIdentitySyncPolicyTemplate |
| GET | `/policies/crossTenantAccessPolicy/templates/multiTenantOrganizationPartnerConfiguration` | Get multiTenantOrganizationPartnerConfigurationTemplate |
| GET | `/policies/featureRolloutPolicies` | List featureRolloutPolicies |
| GET | `/policies/featureRolloutPolicies/{id}` | Get featureRolloutPolicy |
| GET | `/policies/homeRealmDiscoveryPolicies` | List homeRealmDiscoveryPolicies |
| GET | `/policies/homeRealmDiscoveryPolicies/{id}` | Get homeRealmDiscoveryPolicy |
| GET | `/policies/homeRealmDiscoveryPolicies/{id}/appliesTo` | List appliesTo |
| GET | `/policies/identitySecurityDefaultsEnforcementPolicy` | Get identitySecurityDefaultsEnforcementPolicy |
| GET | `/policies/roleManagementPolicies?$filter=scopeId eq '{groupId}' and scopeType eq 'Group'` | List roleManagementPolicies |
| GET | `/policies/roleManagementPolicies?$filter=scopeId eq '/' and scopeType eq 'DirectoryRole'` | List roleManagementPolicies |
| GET | `/policies/roleManagementPolicies/{unifiedRoleManagementPolicyId}` | Get unifiedRoleManagementPolicy |
| GET | `/policies/roleManagementPolicies/{unifiedRoleManagementPolicyId}/rules` | List rules (for a role management policy) |
| GET | `/policies/roleManagementPolicies/{unifiedRoleManagementPolicyId}/rules/{unifiedRoleManagementPolicyRuleId}` | Get unifiedRoleManagementPolicyRule |
| GET | `/policies/roleManagementPolicyAssignments?$filter=scopeId eq '{groupId}' and scopeType eq 'Group'` | List roleManagementPolicyAssignments |
| GET | `/policies/roleManagementPolicyAssignments?$filter=scopeId eq '/' and scopeType eq 'DirectoryRole'` | List roleManagementPolicyAssignments |
| GET | `/policies/roleManagementPolicyAssignments/{unifiedRoleManagementPolicyAssignmentId}` | Get unifiedRoleManagementPolicyAssignment |
| GET | `/roleManagement/directory/roleAssignments` | List unifiedRoleAssignments |
| GET | `/roleManagement/directory/roleAssignments/{id}` | Get unifiedRoleAssignment |
| GET | `/roleManagement/directory/roleAssignmentScheduleInstances` | List roleAssignmentScheduleInstances |
| GET | `/roleManagement/directory/roleAssignmentScheduleInstances/{unifiedRoleAssignmentScheduleInstanceId}` | Get unifiedRoleAssignmentScheduleInstance |
| GET | `/roleManagement/directory/roleAssignmentScheduleInstances/filterByCurrentUser(on=parameterValue)` | unifiedRoleAssignmentScheduleInstance: filterByCurrentUser |
| GET | `/roleManagement/directory/roleAssignmentScheduleRequests` | List roleAssignmentScheduleRequests |
| GET | `/roleManagement/directory/roleAssignmentScheduleRequests/{unifiedRoleAssignmentScheduleRequestId}` | Get unifiedRoleAssignmentScheduleRequest |
| GET | `/roleManagement/directory/roleAssignmentScheduleRequests/filterByCurrentUser(on='parameterValue')` | unifiedRoleAssignmentScheduleRequest: filterByCurrentUser |
| GET | `/roleManagement/directory/roleAssignmentSchedules` | List roleAssignmentSchedules |
| GET | `/roleManagement/directory/roleAssignmentSchedules/{unifiedRoleAssignmentScheduleId}` | Get unifiedRoleAssignmentSchedule |
| GET | `/roleManagement/directory/roleAssignmentSchedules/filterByCurrentUser(on='parameterValue')` | unifiedRoleAssignmentSchedule: filterByCurrentUser |
| GET | `/roleManagement/directory/roleDefinitions` | List roleDefinitions |
| GET | `/roleManagement/directory/roleDefinitions/{id}` | Get unifiedRoleDefinition |
| GET | `/roleManagement/directory/roleEligibilityScheduleInstances` | List roleEligibilityScheduleInstances |
| GET | `/roleManagement/directory/roleEligibilityScheduleInstances/{unifiedRoleEligibilityScheduleInstanceId}` | Get unifiedRoleEligibilityScheduleInstance |
| GET | `/roleManagement/directory/roleEligibilityScheduleInstances/filterByCurrentUser(on='parameterValue')` | unifiedRoleEligibilityScheduleInstance: filterByCurrentUser |
| GET | `/roleManagement/directory/roleEligibilityScheduleRequests` | List roleEligibilityScheduleRequests |
| GET | `/roleManagement/directory/roleEligibilityScheduleRequests/{unifiedRoleEligibilityScheduleRequestId}` | Get unifiedRoleEligibilityScheduleRequest |
| GET | `/roleManagement/directory/roleEligibilityScheduleRequests/filterByCurrentUser(on='parameterValue')` | unifiedRoleEligibilityScheduleRequest: filterByCurrentUser |
| GET | `/roleManagement/directory/roleEligibilitySchedules` | List roleEligibilitySchedules |
| GET | `/roleManagement/directory/roleEligibilitySchedules/{unifiedRoleEligibilityScheduleId}` | Get unifiedRoleEligibilitySchedule |
| GET | `/roleManagement/directory/roleEligibilitySchedules/filterByCurrentUser(on='parameterValue')` | unifiedRoleEligibilitySchedule: filterByCurrentUser |
| GET | `/roleManagement/entitlementManagement/roleAssignments` | List unifiedRoleAssignments |
| GET | `/roleManagement/entitlementManagement/roleAssignments/{id}` | Get unifiedRoleAssignment |
| GET | `/roleManagement/entitlementManagement/roleDefinitions` | List roleDefinitions |
| GET | `/roleManagement/entitlementManagement/roleDefinitions/{id}` | Get unifiedRoleDefinition |
| GET | `/servicePrincipals(appId='{appId}')/appRoleAssignedTo` | List appRoleAssignments granted for a service principal |
| GET | `/servicePrincipals(appId='{resource-servicePrincipal-appId}')/appRoleAssignedTo/{appRoleAssignment-id}` | Get appRoleAssignment |
| GET | `/servicePrincipals(appId='{appId}')/appRoleAssignments` | List appRoleAssignments granted to a service principal |
| GET | `/servicePrincipals(appId='{client-servicePrincipal-appId}')/appRoleAssignments/{appRoleAssignment-id}` | Get appRoleAssignment |
| GET | `/servicePrincipals(appId='{appId}')/homeRealmDiscoveryPolicies` | List assigned homeRealmDiscoveryPolicies |
| GET | `/servicePrincipals/{id}/appRoleAssignedTo` | List appRoleAssignments granted for a service principal |
| GET | `/servicePrincipals/{resource-serviceprincipal-id}/appRoleAssignedTo/{appRoleAssignment-id}` | Get appRoleAssignment |
| GET | `/servicePrincipals/{id}/appRoleAssignments` | List appRoleAssignments granted to a service principal |
| GET | `/servicePrincipals/{client-serviceprincipal-id}/appRoleAssignments/{appRoleAssignment-id}` | Get appRoleAssignment |
| GET | `/servicePrincipals/{id}/homeRealmDiscoveryPolicies` | List assigned homeRealmDiscoveryPolicies |
| GET | `/subscribedSkus` | List subscribedSkus |
| GET | `/subscribedSkus/{id}` | Get subscribedSku |
| GET | `/tenantRelationships/delegatedAdminCustomers` | List delegatedAdminCustomers |
| GET | `/tenantRelationships/delegatedAdminCustomers/{delegatedAdminCustomerId}` | Get delegatedAdminCustomer |
| GET | `/tenantRelationships/delegatedAdminCustomers/{delegatedAdminCustomerId}/serviceManagementDetails` | List serviceManagementDetails |
| GET | `/tenantRelationships/delegatedAdminRelationships` | List delegatedAdminRelationships |
| GET | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}` | Get delegatedAdminRelationship |
| GET | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}/accessAssignments` | List accessAssignments |
| GET | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}/accessAssignments/{delegatedAdminAccessAssignmentId}` | Get delegatedAdminAccessAssignment |
| GET | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}/operations` | List operations |
| GET | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}/operations/{delegatedAdminRelationshipOperationId}` | Get delegatedAdminRelationshipOperation |
| GET | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}/requests` | List requests |
| GET | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}/requests/{delegatedAdminRelationshipRequestId}` | Get delegatedAdminRelationshipRequest |
| GET | `/tenantRelationships/findTenantInformationByDomainName(domainName='{id}')` | tenantRelationship: findTenantInformationByDomainName |
| GET | `/tenantRelationships/findTenantInformationByTenantId(tenantId='{id}')` | tenantRelationship: findTenantInformationByTenantId |
| GET | `/tenantRelationships/multiTenantOrganization` | Get multiTenantOrganization |
| GET | `/tenantRelationships/multiTenantOrganization/joinRequest` | Get multiTenantOrganizationJoinRequestRecord |
| GET | `/tenantRelationships/multiTenantOrganization/tenants` | List multiTenantOrganizationMembers |
| GET | `/tenantRelationships/multiTenantOrganization/tenants/{tenantId}` | Get multiTenantOrganizationMember |
| GET | `/users/{id \| userPrincipalName}/agreementAcceptances` | List agreementAcceptances |
| GET | `/users/{id \| userPrincipalName}/appRoleAssignments` | List appRoleAssignments granted to a user |
| GET | `/users/{user-id}/appRoleAssignments/{appRoleAssignment-id}` | Get appRoleAssignment |
| GET | `/users/{usersId}/authentication/externalAuthenticationMethods` | List externalAuthenticationMethod objects |
| GET | `/users/{usersId}/authentication/externalAuthenticationMethods/{externalAuthenticationMethodId}` | Get externalAuthenticationMethod |
| GET | `/users/{id \| userPrincipalName}/authentication/microsoftAuthenticatorMethods` | List microsoftAuthenticatorAuthenticationMethods |
| GET | `/users/{id \| userPrincipalName}/authentication/microsoftAuthenticatorMethods/{microsoftAuthenticatorAuthenticationMethodId}` | Get microsoftAuthenticatorAuthenticationMethod |
| GET | `/users/{id \| userPrincipalName}/authentication/operations/{id}` | Get longRunningOperation |
| GET | `/users/{id \| userPrincipalName}/authentication/passwordMethods/{passwordMethods-id}` | Get passwordAuthenticationMethod |
| GET | `/users/{userId \| userPrincipalName}/authentication/phoneMethods/{phoneMethodId}` | Get phoneAuthenticationMethod |
| GET | `/users/{id \| userPrincipalName}/authentication/platformCredentialMethods` | List platformCredentialAuthenticationMethods |
| GET | `/users/{id \| userPrincipalName}/authentication/platformCredentialMethods/{platformCredentialAuthenticationMethodId}` | Get platformCredentialAuthenticationMethod |
| GET | `/users/{id \| userPrincipalName}/authentication/qrCodePinMethod` | Get qrCodePinAuthenticationMethod |
| GET | `/users/{id}/authentication/qrCodePinMethod/standardQRCode` | Get qrCode |
| GET | `/users/{id}/authentication/qrCodePinMethod/temporaryQRCode` | Get qrCode |
| GET | `/users/{id \| userPrincipalName}/authentication/softwareOathMethods/{id}` | Get softwareOathAuthenticationMethod |
| GET | `/users/{id \| userPrincipalName}/authentication/temporaryAccessPassMethods/{temporaryAccessPassAuthenticationMethodId}` | Get temporaryAccessPassAuthenticationMethod |
| GET | `/users/{id \| userPrincipalName}/authentication/windowsHelloForBusinessMethods` | List windowsHelloForBusinessAuthenticationMethods |
| GET | `/users/{id \| userPrincipalName}/authentication/windowsHelloForBusinessMethods/{windowsHelloForBusinessAuthenticationMethodId}` | Get windowsHelloForBusinessAuthenticationMethod |
| PATCH | `/devices(deviceId='{deviceId}')` | Update device |
| PATCH | `/devices/{id}` | Update device |
| PATCH | `/directory/administrativeUnits/{id}` | Update administrativeUnit |
| PATCH | `/directory/attributeSets/{attributeSetId}` | Update attributeSet |
| PATCH | `/directory/customSecurityAttributeDefinitions/{customSecurityAttributeDefinitionId}` | Update customSecurityAttributeDefinition |
| PATCH | `/directory/customSecurityAttributeDefinitions/{customSecurityAttributeDefinitionId}/allowedValues/{allowedValueId}` | Update allowedValue |
| PATCH | `directory/federationConfigurations/graph.samlOrWsFedExternalDomainFederation/{samlOrWsFedExternalDomainFederation ID}` | Update samlOrWsFedExternalDomainFederation |
| PATCH | `/directory/onPremisesSynchronization/{id}` | Update onPremisesDirectorySynchronization |
| PATCH | `/directory/publicKeyInfrastructure/certificateBasedAuthConfigurations/{certificateBasedAuthPkiId}` | Update certificateBasedAuthPki |
| PATCH | `/directory/publicKeyInfrastructure/certificateBasedAuthConfigurations/{certificateBasedAuthPkiId}/certificateAuthorities/{certificateAuthorityDetailId}` | Update certificateAuthorityDetail |
| PATCH | `/domains/{id}` | Update domain |
| PATCH | `/domains/{domainsId}/federationConfiguration/{internalDomainFederationId}` | Update internalDomainFederation |
| PATCH | `/groups/{groupId}/settings/{groupSettingId}` | Update groupSetting |
| PATCH | `/groupSettings/{groupSettingId}` | Update groupSetting |
| PATCH | `/identity/apiConnectors/{identityApiConnectorId}` | Update identityApiConnector |
| PATCH | `/identity/authenticationEventListeners/{authenticationEventListenerId}` | Update authenticationEventListener |
| PATCH | `/identity/authenticationEventsFlows/{authenticationEventsFlow-id}` | Update authenticationEventsFlow |
| PATCH | `/identity/b2xUserFlows/{id}/userAttributeAssignments/{id}` | Update identityUserFlowAttributeAssignment |
| PATCH | `/identity/conditionalAccess/authenticationContextClassReferences/{id}` | Create or Update authenticationContextClassReference |
| PATCH | `/identity/conditionalAccess/authenticationStrength/policies/{authenticationStrengthPolicyId}/combinationConfigurations/{authenticationCombinationConfigurationId}` | Update authenticationCombinationConfiguration |
| PATCH | `/identity/conditionalAccess/namedLocations/{id}` | Update countryNamedlocation |
| PATCH | `/identity/conditionalAccess/policies/{id}` | Update conditionalaccesspolicy |
| PATCH | `/identity/customAuthenticationExtensions/{customAuthenticationExtensionId}` | Update customAuthenticationExtension |
| PATCH | `/identity/identityProviders/{id}` | Update identityProvider |
| PATCH | `/identity/riskPrevention/fraudProtectionProviders/{fraudProtectionProviderId}` | Update fraudProtectionProvider |
| PATCH | `/identity/riskPrevention/webApplicationFirewallProviders/{webApplicationFirewallProviderId}` | Update webApplicationFirewallProvider |
| PATCH | `/identity/userFlowAttributes/{id}` | Update identityUserFlowAttribute |
| PATCH | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/decisions/{accessReviewInstanceDecisionItemId}` | Update accessReviewInstanceDecisionItem |
| PATCH | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/stages/{accessReviewStageId}` | Update accessReviewStage |
| PATCH | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/stages/{accessReviewStageId}/decisions/{accessReviewInstanceDecisionItemId}` | Update accessReviewInstanceDecisionItem |
| PATCH | `/identityGovernance/entitlementManagement/accessPackageAssignmentApprovals/{accessPackageAssignmentRequestId}/stages/{approvalStageId}` | Update approvalStage |
| PATCH | `/identityGovernance/entitlementManagement/accessPackages/{accessPackageId}` | Update accessPackage |
| PATCH | `/identityGovernance/entitlementManagement/catalogs/{accessPackageCatalogId}` | Update accessPackageCatalog |
| PATCH | `/identityGovernance/entitlementManagement/connectedOrganizations/{connectedOrganizationId}` | Update a connectedOrganization object |
| PATCH | `/identityGovernance/entitlementManagement/settings` | Update entitlementManagementSettings |
| PATCH | `/identityGovernance/lifecycleWorkflows/customTaskExtensions/{customTaskExtensionId}` | Update customTaskExtension |
| PATCH | `/identityGovernance/lifecycleWorkflows/settings` | Update lifecycleManagementSettings |
| PATCH | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}` | Update workflow |
| PATCH | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/tasks/{taskId}` | Update task |
| PATCH | `/identityGovernance/privilegedAccess/group/assignmentApprovals/{privilegedaccessgroupassignmentschedulerequestId}/stages/{approvalStageId}` | Update approvalStage |
| PATCH | `/identityGovernance/termsOfUse/agreements/{id}` | Update agreement |
| PATCH | `/identityProviders/{id}` | Update identityProvider |
| PATCH | `/me/authentication/qrCodePinMethod/pin` | Update qrPin |
| PATCH | `/me/authentication/qrCodePinMethod/pin/updatepin` | qrPin: updatePin |
| PATCH | `/me/authentication/qrCodePinMethod/standardQRCode` | Create or Update qrCode |
| PATCH | `/me/authentication/qrCodePinMethod/temporaryQRCode` | Create or Update qrCode |
| PATCH | `/oauth2PermissionGrants/{id}` | Update an oAuth2PermissionGrant |
| PATCH | `/organization/{id}` | Update organization |
| PATCH | `/organization/{organizationId}/branding` | Update organizationalBranding |
| PATCH | `/organization/{organizationId}/branding/localizations/{organizationalBrandingLocalizationId}` | Update organizationalBrandingLocalization |
| PATCH | `/policies/activityBasedTimeoutPolicies/{id}` | Update activitybasedtimeoutpolicy |
| PATCH | `/policies/authenticationFlowsPolicy` | Update authenticationFlowsPolicy |
| PATCH | `/policies/authenticationMethodsPolicy` | Update authenticationMethodsPolicy |
| PATCH | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/{id}` | Update externalAuthenticationMethodConfiguration |
| PATCH | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/email` | Update emailAuthenticationMethodConfiguration |
| PATCH | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/fido2` | Update fido2AuthenticationMethodConfiguration |
| PATCH | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/microsoftAuthenticator` | Update microsoftAuthenticatorAuthenticationMethodConfiguration |
| PATCH | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/qrCodePin` | Update qrCodePinAuthenticationMethodConfiguration |
| PATCH | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/sms` | Update smsAuthenticationMethodConfiguration |
| PATCH | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/softwareOath` | Update softwareOathAuthenticationMethodConfiguration |
| PATCH | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/TemporaryAccessPass` | Update temporaryAccessPassAuthenticationMethodConfiguration |
| PATCH | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/voice` | Update voiceAuthenticationMethodConfiguration |
| PATCH | `/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/x509Certificate` | Update x509CertificateAuthenticationMethodConfiguration |
| PATCH | `/policies/authenticationStrengthPolicies/{authenticationStrengthPolicyId}` | Update authenticationStrengthPolicy |
| PATCH | `/policies/authorizationPolicy` | Update authorizationPolicy |
| PATCH | `/policies/crossTenantAccessPolicy` | Update crossTenantAccessPolicy |
| PATCH | `/policies/crossTenantAccessPolicy/default` | Update crossTenantAccessPolicyConfigurationDefault |
| PATCH | `/policies/crossTenantAccessPolicy/partners/{id}` | Update crossTenantAccessPolicyConfigurationPartner |
| PATCH | `/policies/crossTenantAccessPolicy/partners/{id}/identitySynchronization` | Update crossTenantIdentitySyncPolicyPartner |
| PATCH | `/policies/crossTenantAccessPolicy/templates/multiTenantOrganizationIdentitySynchronization` | Update multiTenantOrganizationIdentitySyncPolicyTemplate |
| PATCH | `/policies/crossTenantAccessPolicy/templates/multiTenantOrganizationPartnerConfiguration` | Update multiTenantOrganizationPartnerConfigurationTemplate |
| PATCH | `/policies/featureRolloutPolicies/{id}` | Update featureRolloutPolicy |
| PATCH | `/policies/homeRealmDiscoveryPolicies/{id}` | Update homerealmdiscoverypolicy |
| PATCH | `/policies/identitySecurityDefaultsEnforcementPolicy` | Update identitySecurityDefaultsEnforcementPolicy |
| PATCH | `/policies/roleManagementPolicies/{unifiedRoleManagementPolicyId}` | Update unifiedRoleManagementPolicy |
| PATCH | `/policies/roleManagementPolicies/{unifiedRoleManagementPolicyId}/rules/{unifiedRoleManagementPolicyRuleId}` | Update unifiedRoleManagementPolicyRule |
| PATCH | `/roleManagement/directory/roleDefinitions/{id}` | Update unifiedRoleDefinition |
| PATCH | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}` | Update delegatedAdminRelationship |
| PATCH | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}/accessAssignments/{delegatedAdminAccessAssignmentId}` | Update delegatedAdminAccessAssignment |
| PATCH | `/tenantRelationships/multiTenantOrganization` | Update multiTenantOrganization |
| PATCH | `/tenantRelationships/multiTenantOrganization/joinRequest` | Update multiTenantOrganizationJoinRequestRecord |
| PATCH | `/tenantRelationships/multiTenantOrganization/tenants/{tenantId}` | Update multiTenantOrganizationMember |
| PATCH | `/users/{id \| userPrincipalName}/authentication/phoneMethods/{phoneMethodId}` | Update phoneAuthenticationMethod |
| PATCH | `/users/{id}/authentication/qrCodePinMethod/pin` | Update qrPin |
| PATCH | `/users/{usersId}/authentication/qrCodePinMethod/pin/updatepin` | qrPin: updatePin |
| PATCH | `/users/{id}/authentication/qrCodePinMethod/standardQRCode` | Create or Update qrCode |
| PATCH | `/users/{id}/authentication/qrCodePinMethod/temporaryQRCode` | Create or Update qrCode |
| POST | `/agreements/{agreementsId}/files` | Create agreementFileLocalization |
| POST | `/contacts/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/contacts/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/contacts/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/contacts/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/contacts/{id}/retryServiceProvisioning` | orgContact: retryServiceProvisioning |
| POST | `/devices` | Create device |
| POST | `/devices(deviceId='{deviceId}')/registeredOwners/$ref` | Create registeredOwner |
| POST | `/devices(deviceId='{deviceId}')/registeredUsers/$ref` | Create registeredUser |
| POST | `/devices/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/devices/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/devices/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/devices/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/devices/{id}/registeredOwners/$ref` | Create registeredOwner |
| POST | `/devices/{id}/registeredUsers/$ref` | Create registeredUser |
| POST | `/directory/administrativeUnits` | Create administrativeUnit |
| POST | `/directory/administrativeUnits/{id}/members` | Add a member |
| POST | `/directory/administrativeUnits/{id}/members/$ref` | Add a member |
| POST | `/directory/administrativeUnits/{id}/scopedRoleMembers` | Add a scopedRoleMember |
| POST | `/directory/attributeSets` | Create attributeSet |
| POST | `/directory/customSecurityAttributeDefinitions` | Create customSecurityAttributeDefinition |
| POST | `/directory/customSecurityAttributeDefinitions/{customSecurityAttributeDefinitionId}/allowedValues` | Create allowedValue |
| POST | `/directory/deletedItems/{id}/restore` | Restore deleted directory object item |
| POST | `/directory/deletedItems/getUserOwnedObjects` | List deleted items (directory objects) owned by a user |
| POST | `/directory/federationConfigurations/{samlOrWsFedExternalDomainFederation ID}/microsoft.graph.samlOrWsFedExternalDomainFederation/domains` | Create externalDomainName |
| POST | `/directory/federationConfigurations/microsoft.graph.samlOrWsFedExternalDomainFederation` | Create samlOrWsFedExternalDomainFederation |
| POST | `/directory/publicKeyInfrastructure/certificateBasedAuthConfigurations` | Create certificateBasedAuthPki |
| POST | `/directory/publicKeyInfrastructure/certificateBasedAuthConfigurations/{certificateBasedAuthPkiId}/certificateAuthorities` | Create certificateAuthorityDetail |
| POST | `/directory/publicKeyInfrastructure/certificateBasedAuthConfigurations/{certificateBasedAuthPkiId}/upload` | certificateBasedAuthPki: upload |
| POST | `/directoryObjects/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/directoryObjects/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/directoryObjects/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/directoryObjects/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/directoryObjects/getAvailableExtensionProperties` | directoryObject: getAvailableExtensionProperties |
| POST | `/directoryObjects/getByIds` | directoryObject: getByIds |
| POST | `/directoryObjects/validateProperties` | directoryObject: validateProperties |
| POST | `/directoryRoles` | Activate directoryRole |
| POST | `/directoryRoles/{role-id}/members/$ref` | Add directory role member |
| POST | `/directoryRoles/roleTemplateId={roleTemplateId}/members/$ref` | Add directory role member |
| POST | `/domains` | Create domain |
| POST | `/domains/{domainsId}/federationConfiguration` | Create internalDomainFederation |
| POST | `/domains/{id}/forceDelete` | domain: forceDelete |
| POST | `/domains/{id}/promote` | domain: promote |
| POST | `/domains/{id}/verify` | domain: verify |
| POST | `/groups/{groupId}/appRoleAssignments` | Grant an appRoleAssignment to a group |
| POST | `/groups/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/groups/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/groups/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/groups/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/groups/{id}/settings` | Create settings |
| POST | `/groupSettings` | Create settings |
| POST | `/identity/apiConnectors` | Create identityApiConnector |
| POST | `/identity/apiconnectors/{id}/uploadClientCertificate` | identityApiConnector: uploadClientCertificate |
| POST | `/identity/authenticationEventListeners` | Create authenticationEventListener |
| POST | `/identity/authenticationEventsFlows` | Create authenticationEventsFlow |
| POST | `/identity/authenticationEventsFlows/{authenticationEventsFlow-id}/conditions/applications/includeApplications` | Add includeApplication (to a user flow) |
| POST | `/identity/authenticationEventsFlows/{authenticationEventsFlow-id}/microsoft.graph.externalUsersSelfServiceSignUpEventsFlow/onAttributeCollection/microsoft.graph.onAttributeCollectionExternalUsersSelfServiceSignUp/attributes/$ref` | Add attribute (to user flow) |
| POST | `/identity/authenticationEventsFlows/{authenticationEventsFlow-id}/microsoft.graph.externalUsersSelfServiceSignUpEventsFlow/onAuthenticationMethodLoadStart/microsoft.graph.onAuthenticationMethodLoadStartExternalUsersSelfServiceSignUp/identityProviders/$ref` | Add identityProvider (to a user flow) |
| POST | `/identity/b2xUserFlows` | Create b2xIdentityUserFlow |
| POST | `/identity/b2xUserFlows/{id}/identityProviders/$ref` | Add identityProvider |
| POST | `/identity/b2xUserFlows/{id}/userAttributeAssignments` | Create userAttributeAssignments |
| POST | `/identity/b2xUserFlows/{b2xIdentityUserFlowId}/userAttributeAssignments/setOrder` | identityUserFlowAttributeAssignment: setOrder |
| POST | `/identity/conditionalAccess/authenticationStrength/policies/{authenticationStrengthPolicyId}/combinationConfigurations` | Create authenticationCombinationConfiguration |
| POST | `/identity/conditionalAccess/evaluate` | What If evaluation |
| POST | `/identity/conditionalAccess/namedLocations` | Create namedLocation |
| POST | `/identity/conditionalAccess/policies` | Create conditionalAccessPolicy |
| POST | `/identity/customAuthenticationExtensions` | Create customAuthenticationExtension |
| POST | `/identity/customAuthenticationExtensions/{customAuthenticationExtensionId}/validateAuthenticationConfiguration` | customAuthenticationExtension: validateAuthenticationConfiguration |
| POST | `/identity/customAuthenticationExtensions/validateAuthenticationConfiguration` | customAuthenticationExtension: validateAuthenticationConfiguration |
| POST | `/identity/identityProviders` | Create identityProvider |
| POST | `/identity/riskPrevention/fraudProtectionProviders` | Create fraudProtectionProviders |
| POST | `/identity/riskPrevention/webApplicationFirewallProviders` | Create webApplicationFirewallProvider |
| POST | `/identity/riskPrevention/webApplicationFirewallProviders/{webApplicationFirewallProviderId}/verify` | webApplicationFirewallProvider: verify |
| POST | `/identity/userFlowAttributes` | Create identityUserFlowAttribute |
| POST | `/identityGovernance/accessReviews/definitions` | Create definitions |
| POST | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/acceptRecommendations` | accessReviewInstance: acceptRecommendations |
| POST | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/applyDecisions` | accessReviewInstance: applyDecisions |
| POST | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/batchRecordDecisions` | accessReviewInstance: batchRecordDecisions |
| POST | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/resetDecisions` | accessReviewInstance: resetDecisions |
| POST | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/sendReminder` | accessReviewInstance: sendReminder |
| POST | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/stages/{accessReviewStageId}/stop` | accessReviewStage: stop |
| POST | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}/stop` | accessReviewInstance: stop |
| POST | `/identityGovernance/accessReviews/historyDefinitions` | Create historyDefinitions |
| POST | `/identityGovernance/accessReviews/historyDefinitions/{accessReviewHistoryDefinitionId}/instances/{accessReviewHistoryInstanceId}/generateDownloadUri` | accessReviewHistoryInstance: generateDownloadUri |
| POST | `/identityGovernance/entitlementManagement/accessPackageCatalogs/{accessPackageCatalogId}/accessPackageResources/{accessPackageResourceId}/refresh` | accessPackageResource: refresh |
| POST | `/identityGovernance/entitlementManagement/accessPackages` | Create accessPackage |
| POST | `/identityGovernance/entitlementManagement/accessPackages/{accessPackageId}/getApplicablePolicyRequirements` | accessPackage: getApplicablePolicyRequirements |
| POST | `/identityGovernance/entitlementManagement/accessPackages/{id}/incompatibleAccessPackages/$ref` | Add accessPackage to incompatibleAccessPackages |
| POST | `/identityGovernance/entitlementManagement/accessPackages/{id}/incompatibleGroups/$ref` | Add group to incompatibleGroups |
| POST | `/identityGovernance/entitlementManagement/accessPackages/{id}/resourceRoleScopes` | Create resourceRoleScope |
| POST | `/identityGovernance/entitlementManagement/assignmentPolicies` | Create assignmentPolicies |
| POST | `/identityGovernance/entitlementManagement/assignmentRequests` | Create accessPackageAssignmentRequest |
| POST | `/identityGovernance/entitlementManagement/assignmentRequests/{accessPackageAssignmentRequestId}/cancel` | accessPackageAssignmentRequest: cancel |
| POST | `/identityGovernance/entitlementManagement/assignmentRequests/{id}/reprocess` | accessPackageAssignmentRequest: reprocess |
| POST | `/identityGovernance/entitlementManagement/assignmentRequests/{accessPackageAssignmentRequestId}/resume` | accessPackageAssignmentRequest: resume |
| POST | `/identityGovernance/entitlementManagement/assignments/{id}/reprocess` | accessPackageAssignment: reprocess |
| POST | `/identityGovernance/entitlementManagement/catalogs` | Create accessPackageCatalog |
| POST | `/identityGovernance/entitlementManagement/catalogs/{catalogId}/customWorkflowExtensions` | Create accessPackageCustomWorkflowExtension |
| POST | `/identityGovernance/entitlementManagement/connectedOrganizations` | Create connectedOrganization |
| POST | `/identityGovernance/entitlementManagement/connectedOrganizations/{id}/externalSponsors/$ref` | Add externalSponsors |
| POST | `/identityGovernance/entitlementManagement/connectedOrganizations/{id}/internalSponsors/$ref` | Add internalSponsors |
| POST | `/identityGovernance/entitlementManagement/resourceRequests` | Create accessPackageResourceRequest |
| POST | `/identityGovernance/lifecycleWorkflows/customTaskExtensions` | Create Custom Task Extension |
| POST | `/identityGovernance/lifecycleWorkflows/deletedItems/workflows/{workflowId}/restore` | workflow: restore |
| POST | `/identityGovernance/lifecycleWorkflows/workflows` | Create workflow |
| POST | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/activate` | workflow: activate |
| POST | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/activatewithscope` | workflow: activateWithScope |
| POST | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/createNewVersion` | workflow: createNewVersion |
| POST | `/identityGovernance/lifecycleWorkflows/workflows/{workflowId}/tasks/{taskId}/taskProcessingResults/{taskProcessingResultsId}/resume` | taskProcessingResult: resume |
| POST | `/identityGovernance/privilegedAccess/group/assignmentScheduleRequests` | Create assignmentScheduleRequest |
| POST | `/identityGovernance/privilegedAccess/group/assignmentScheduleRequests/{privilegedAccessGroupAssignmentScheduleRequestId}/cancel` | privilegedAccessGroupAssignmentScheduleRequest: cancel |
| POST | `/identityGovernance/privilegedAccess/group/eligibilityScheduleRequests` | Create eligibilityScheduleRequest |
| POST | `/identityGovernance/privilegedAccess/group/eligibilityScheduleRequests/{privilegedAccessGroupEligibilityScheduleRequestId}/cancel` | privilegedAccessGroupEligibilityScheduleRequest: cancel |
| POST | `/identityGovernance/termsOfUse/agreements` | Create agreement |
| POST | `/identityProtection/riskyServicePrincipals/confirmCompromised` | riskyServicePrincipal: confirmCompromised |
| POST | `/identityProtection/riskyServicePrincipals/dismiss` | riskyServicePrincipal: dismiss |
| POST | `/identityProtection/riskyUsers/confirmCompromised` | riskyUser: confirmCompromised |
| POST | `/identityProtection/riskyUsers/confirmSafe` | riskyUser: confirmSafe |
| POST | `/identityProtection/riskyUsers/dismiss` | riskyUser: dismiss |
| POST | `/identityProviders` | Create identityProvider |
| POST | `/me/authentication/phoneMethods/{mobilePhoneMethodId}/disableSmsSignIn` | phoneAuthenticationMethod: disableSmsSignIn |
| POST | `/me/authentication/phoneMethods/{id}/enableSmsSignIn` | phoneAuthenticationMethod: enableSmsSignIn |
| POST | `/me/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/me/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/me/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/me/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/oauth2PermissionGrants` | Create oAuth2PermissionGrant (a delegated permission grant) |
| POST | `/organization/{organizationId}/branding/localizations` | Create organizationalBrandingLocalization |
| POST | `/organization/{id}/certificateBasedAuthConfiguration` | Create certificateBasedAuthConfiguration |
| POST | `/policies/activityBasedTimeoutPolicies` | Create activityBasedTimeoutPolicy |
| POST | `/policies/authenticationStrengthPolicies` | Create authenticationStrengthPolicy |
| POST | `/policies/authenticationStrengthPolicies/{authenticationStrengthPolicyId}/updateAllowedCombinations` | authenticationStrengthPolicy: updateAllowedCombinations |
| POST | `/policies/crossTenantAccessPolicy/default/resetToSystemDefault` | crossTenantAccessPolicyConfigurationDefault: resetToSystemDefault |
| POST | `/policies/crossTenantAccessPolicy/partners` | Create crossTenantAccessPolicyConfigurationPartner |
| POST | `/policies/crossTenantAccessPolicy/templates/multiTenantOrganizationIdentitySynchronization/resetToDefaultSettings` | multiTenantOrganizationIdentitySyncPolicyTemplate: resetToDefaultSettings |
| POST | `/policies/crossTenantAccessPolicy/templates/multiTenantOrganizationPartnerConfiguration/resetToDefaultSettings` | multiTenantOrganizationPartnerConfigurationTemplate: resetToDefaultSettings |
| POST | `/policies/featureRolloutPolicies` | Create featureRolloutPolicy |
| POST | `/policies/featureRolloutPolicies/{id}/appliesTo/$ref` | Assign appliesTo on a featureRolloutPolicy |
| POST | `/policies/homeRealmDiscoveryPolicies` | Create homeRealmDiscoveryPolicy |
| POST | `/roleManagement/directory/roleAssignments` | Create unifiedRoleAssignment |
| POST | `/roleManagement/directory/roleAssignmentScheduleRequests` | Create roleAssignmentScheduleRequests |
| POST | `/roleManagement/directory/roleAssignmentScheduleRequests/{unifiedRoleAssignmentScheduleRequestId}/cancel` | unifiedRoleAssignmentScheduleRequest: cancel |
| POST | `/roleManagement/directory/roleDefinitions` | Create roleDefinitions |
| POST | `/roleManagement/directory/roleEligibilityScheduleRequests` | Create roleEligibilityScheduleRequest |
| POST | `/roleManagement/directory/roleEligibilityScheduleRequests/{unifiedRoleEligibilityScheduleRequestId}/cancel` | unifiedRoleEligibilityScheduleRequest: cancel |
| POST | `/roleManagement/entitlementManagement/roleAssignments` | Create unifiedRoleAssignment |
| POST | `/servicePrincipals(appId='{appId}')/appRoleAssignedTo` | Grant an appRoleAssignment for a service principal |
| POST | `/servicePrincipals(appId='{appId}')/appRoleAssignments` | Grant an appRoleAssignment to a service principal |
| POST | `/servicePrincipals(appId='{appId}')/homeRealmDiscoveryPolicies/$ref` | Assign homeRealmDiscoveryPolicy |
| POST | `/servicePrincipals/{id}/appRoleAssignedTo` | Grant an appRoleAssignment for a service principal |
| POST | `/servicePrincipals/{id}/appRoleAssignments` | Grant an appRoleAssignment to a service principal |
| POST | `/servicePrincipals/{id}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/servicePrincipals/{id}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/servicePrincipals/{id}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/servicePrincipals/{id}/getMemberObjects` | directoryObject: getMemberObjects |
| POST | `/servicePrincipals/{id}/homeRealmDiscoveryPolicies/$ref` | Assign homeRealmDiscoveryPolicy |
| POST | `/tenantRelationships/delegatedAdminRelationships` | Create delegatedAdminRelationship |
| POST | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}/accessAssignments` | Create accessAssignments |
| POST | `/tenantRelationships/delegatedAdminRelationships/{delegatedAdminRelationshipId}/requests` | Create requests |
| POST | `/tenantRelationships/multiTenantOrganization/tenants` | Add multiTenantOrganizationMember |
| POST | `/users/{id \| userPrincipalName}/appRoleAssignments` | Grant an appRoleAssignment to a user |
| POST | `/users/{usersId}/authentication/externalAuthenticationMethods` | Create externalAuthenticationMethod |
| POST | `/users/{id \| userPrincipalName}/authentication/methods/{passwordMethods-id}/resetPassword` | authenticationMethod: resetPassword |
| POST | `/users/{id \| userPrincipalName}/authentication/phoneMethods` | Create phoneMethod |
| POST | `/users/{id \| userPrincipalName}/authentication/phoneMethods/{mobilePhoneMethodId}/disableSmsSignIn` | phoneAuthenticationMethod: disableSmsSignIn |
| POST | `/users/{id \| userPrincipalName}/authentication/phoneMethods/{id}/enableSmsSignIn` | phoneAuthenticationMethod: enableSmsSignIn |
| POST | `/users/{id \| userPrincipalName}/checkMemberGroups` | directoryObject: checkMemberGroups |
| POST | `/users/{id \| userPrincipalName}/checkMemberObjects` | directoryObject: checkMemberObjects |
| POST | `/users/{id}/exportPersonalData` | user: exportPersonalData |
| POST | `/users/{id \| userPrincipalName}/getMemberGroups` | directoryObject: getMemberGroups |
| POST | `/users/{id \| userPrincipalName}/getMemberObjects` | directoryObject: getMemberObjects |
| PUT | `/identity/b2xUserFlows/{b2xUserFlowId}/apiConnectorConfiguration/{step}/$ref` | Update apiConnectorConfiguration |
| PUT | `/identityGovernance/accessReviews/definitions/{review-id}` | Update accessReviewScheduleDefinition |
| PUT | `/identityGovernance/accessReviews/definitions/{accessReviewScheduleDefinitionId}/instances/{accessReviewInstanceId}` | Update accessReviewInstance |
| PUT | `/identityGovernance/entitlementManagement/assignmentPolicies/{accessPackageAssignmentPolicyId}` | Update accessPackageAssignmentPolicy |
| PUT | `/identityGovernance/entitlementManagement/catalogs/{catalogId}/customWorkflowExtensions/{customAccessPackageWorkflowExtensionId}` | Update accessPackageAssignmentRequestWorkflowExtension |
| PUT | `/me/authentication/qrCodePinMethod` | Create qrCodePinAuthenticationMethod |
| PUT | `/organization/{organizationId}/branding/localizations/{organizationalBrandingLocalizationId}/{Stream object type such as backgroundImage}` | Update organizationalBranding |
| PUT | `/policies/adminConsentRequestPolicy` | Update adminConsentRequestPolicy |
| PUT | `/policies/crossTenantAccessPolicy/partners/{id}/identitySynchronization` | Create identitySynchronization |
| PUT | `/tenantRelationships/multiTenantOrganization` | Create multiTenantOrganization |
| PUT | `/users/{id}/authentication/qrCodePinMethod` | Create qrCodePinAuthenticationMethod |

### OneNote — 107 missing of 116

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/groups/{id}/onenote/pages/{id}` | Delete page |
| DELETE | `/sites/{id}/onenote/pages/{id}` | Delete page |
| DELETE | `/users/{id \| userPrincipalName}/onenote/pages/{id}` | Delete page |
| GET | `/groups/{id}/onenote/notebooks` | List notebooks |
| GET | `/groups/{id}/onenote/notebooks/{id}` | Get notebook |
| GET | `/groups/{id}/onenote/notebooks/{id}/sectionGroups` | List sectionGroups |
| GET | `/groups/{id}/onenote/notebooks/{id}/sections` | List sections |
| GET | `/groups/{id}/onenote/operations/{id}` | Get onenoteOperation |
| GET | `/groups/{id}/onenote/pages` | List onenotePages |
| GET | `/groups/{id}/onenote/pages/{id}` | Get page |
| GET | `/groups/{id}/onenote/resources/{id}/content` | Get resource |
| GET | `/groups/{id}/onenote/sectionGroups` | List sectionGroups |
| GET | `/groups/{id}/onenote/sectionGroups/{id}` | Get sectionGroup |
| GET | `/groups/{id}/onenote/sectionGroups/{id}/sectionGroups` | List sectionGroups |
| GET | `/groups/{id}/onenote/sectionGroups/{id}/sections` | List sections |
| GET | `/groups/{id}/onenote/sections` | List sections |
| GET | `/groups/{id}/onenote/sections/{id}` | Get section |
| GET | `/groups/{id}/onenote/sections/{id}/pages` | List pages |
| GET | `/me/onenote/notebooks/{id}` | Get notebook |
| GET | `/me/onenote/notebooks/{id}/sectionGroups` | List sectionGroups |
| GET | `/me/onenote/notebooks/getRecentNotebooks(includePersonalNotebooks={includePersonalNotebooks})` | notebook: getRecentNotebooks |
| GET | `/me/onenote/operations/{id}` | Get onenoteOperation |
| GET | `/me/onenote/pages` | List onenotePages |
| GET | `/me/onenote/pages/{id}` | Get page |
| GET | `/me/onenote/pages/{id}/$value[?includeIDs=true]` | Get page |
| GET | `/me/onenote/pages/{id}/content[?includeIDs=true]` | Get page |
| GET | `/me/onenote/resources/{id}/content` | Get resource |
| GET | `/me/onenote/sectionGroups` | List sectionGroups |
| GET | `/me/onenote/sectionGroups/{id}` | Get sectionGroup |
| GET | `/me/onenote/sectionGroups/{id}/sectionGroups` | List sectionGroups |
| GET | `/me/onenote/sectionGroups/{id}/sections` | List sections |
| GET | `/me/onenote/sections/{id}` | Get section |
| GET | `/sites/{id}/onenote/notebooks` | List notebooks |
| GET | `/sites/{id}/onenote/notebooks/{id}` | Get notebook |
| GET | `/sites/{id}/onenote/notebooks/{id}/sectionGroups` | List sectionGroups |
| GET | `/sites/{id}/onenote/notebooks/{id}/sections` | List sections |
| GET | `/sites/{id}/onenote/operations/{id}` | Get onenoteOperation |
| GET | `/sites/{id}/onenote/pages` | List onenotePages |
| GET | `/sites/{id}/onenote/pages/{id}` | Get page |
| GET | `/sites/{id}/onenote/resources/{id}/content` | Get resource |
| GET | `/sites/{id}/onenote/sectionGroups` | List sectionGroups |
| GET | `/sites/{id}/onenote/sectionGroups/{id}` | Get sectionGroup |
| GET | `/sites/{id}/onenote/sectionGroups/{id}/sectionGroups` | List sectionGroups |
| GET | `/sites/{id}/onenote/sectionGroups/{id}/sections` | List sections |
| GET | `/sites/{id}/onenote/sections` | List sections |
| GET | `/sites/{id}/onenote/sections/{id}` | Get section |
| GET | `/sites/{id}/onenote/sections/{id}/pages` | List pages |
| GET | `/users/{id \| userPrincipalName}/onenote/notebooks` | List notebooks |
| GET | `/users/{id \| userPrincipalName}/onenote/notebooks/{id}` | Get notebook |
| GET | `/users/{id \| userPrincipalName}/onenote/notebooks/{id}/sectionGroups` | List sectionGroups |
| GET | `/users/{id \| userPrincipalName}/onenote/notebooks/{id}/sections` | List sections |
| GET | `/users/{id \| userPrincipalName}/onenote/notebooks/getRecentNotebooks(includePersonalNotebooks={includePersonalNotebooks})` | notebook: getRecentNotebooks |
| GET | `/users/{id \| userPrincipalName}/onenote/operations/{id}` | Get onenoteOperation |
| GET | `/users/{id \| userPrincipalName}/onenote/pages` | List onenotePages |
| GET | `/users/{id \| userPrincipalName}/onenote/pages/{id}` | Get page |
| GET | `/users/{id \| userPrincipalName}/onenote/resources/{id}/content` | Get resource |
| GET | `/users/{id \| userPrincipalName}/onenote/sectionGroups` | List sectionGroups |
| GET | `/users/{id \| userPrincipalName}/onenote/sectionGroups/{id}` | Get sectionGroup |
| GET | `/users/{id \| userPrincipalName}/onenote/sectionGroups/{id}/sectionGroups` | List sectionGroups |
| GET | `/users/{id \| userPrincipalName}/onenote/sectionGroups/{id}/sections` | List sections |
| GET | `/users/{id \| userPrincipalName}/onenote/sections` | List sections |
| GET | `/users/{id \| userPrincipalName}/onenote/sections/{id}` | Get section |
| GET | `/users/{id \| userPrincipalName}/onenote/sections/{id}/pages` | List pages |
| PATCH | `/groups/{id}/onenote/pages/{id}/content` | Update page |
| PATCH | `/me/onenote/pages/{id}/content` | Update page |
| PATCH | `/sites/{id}/onenote/pages/{id}/content` | Update page |
| PATCH | `/users/{id \| userPrincipalName}/onenote/pages/{id}/content` | Update page |
| POST | `/groups/{id}/onenote/notebooks` | Create notebook |
| POST | `/groups/{id}/onenote/notebooks/{id}/copyNotebook` | notebook: copyNotebook |
| POST | `/groups/{id}/onenote/notebooks/{id}/sectionGroups` | Create sectionGroup |
| POST | `/groups/{id}/onenote/notebooks/{id}/sections` | Create section |
| POST | `/groups/{id}/onenote/notebooks/GetNotebookFromWebUrl` | notebook: getNotebookFromWebUrl |
| POST | `/groups/{id}/onenote/pages` | Create onenotePage |
| POST | `/groups/{id}/onenote/pages/{id}/copyToSection` | page: copyToSection |
| POST | `/groups/{id}/onenote/sectionGroups/{id}/sectionGroups` | Create sectionGroup |
| POST | `/groups/{id}/onenote/sectionGroups/{id}/sections` | Create section |
| POST | `/groups/{id}/onenote/sections/{id}/copyToNotebook` | section: copyToNotebook |
| POST | `/groups/{id}/onenote/sections/{id}/copyToSectionGroup` | section: copyToSectionGroup |
| POST | `/groups/{id}/onenote/sections/{id}/pages` | Create page |
| POST | `/me/onenote/notebooks/{id}/copyNotebook` | notebook: copyNotebook |
| POST | `/me/onenote/notebooks/{id}/sectionGroups` | Create sectionGroup |
| POST | `/me/onenote/notebooks/GetNotebookFromWebUrl` | notebook: getNotebookFromWebUrl |
| POST | `/me/onenote/pages/{id}/copyToSection` | page: copyToSection |
| POST | `/me/onenote/sectionGroups/{id}/sectionGroups` | Create sectionGroup |
| POST | `/me/onenote/sectionGroups/{id}/sections` | Create section |
| POST | `/me/onenote/sections/{id}/copyToNotebook` | section: copyToNotebook |
| POST | `/me/onenote/sections/{id}/copyToSectionGroup` | section: copyToSectionGroup |
| POST | `/sites/{id}/onenote/notebooks` | Create notebook |
| POST | `/sites/{id}/onenote/notebooks/{id}/sectionGroups` | Create sectionGroup |
| POST | `/sites/{id}/onenote/notebooks/{id}/sections` | Create section |
| POST | `/sites/{id}/onenote/notebooks/GetNotebookFromWebUrl` | notebook: getNotebookFromWebUrl |
| POST | `/sites/{id}/onenote/pages` | Create onenotePage |
| POST | `/sites/{id}/onenote/sectionGroups/{id}/sectionGroups` | Create sectionGroup |
| POST | `/sites/{id}/onenote/sectionGroups/{id}/sections` | Create section |
| POST | `/sites/{id}/onenote/sections/{id}/pages` | Create page |
| POST | `/users/{id \| userPrincipalName}/onenote/notebooks` | Create notebook |
| POST | `/users/{id \| userPrincipalName}/onenote/notebooks/{id}/copyNotebook` | notebook: copyNotebook |
| POST | `/users/{id \| userPrincipalName}/onenote/notebooks/{id}/sectionGroups` | Create sectionGroup |
| POST | `/users/{id \| userPrincipalName}/onenote/notebooks/{id}/sections` | Create section |
| POST | `/users/{id \| userPrincipalName}/onenote/notebooks/GetNotebookFromWebUrl` | notebook: getNotebookFromWebUrl |
| POST | `/users/{id \| userPrincipalName}/onenote/pages` | Create onenotePage |
| POST | `/users/{id \| userPrincipalName}/onenote/pages/{id}/copyToSection` | page: copyToSection |
| POST | `/users/{id \| userPrincipalName}/onenote/sectionGroups/{id}/sectionGroups` | Create sectionGroup |
| POST | `/users/{id \| userPrincipalName}/onenote/sectionGroups/{id}/sections` | Create section |
| POST | `/users/{id \| userPrincipalName}/onenote/sections/{id}/copyToNotebook` | section: copyToNotebook |
| POST | `/users/{id \| userPrincipalName}/onenote/sections/{id}/copyToSectionGroup` | section: copyToSectionGroup |
| POST | `/users/{id \| userPrincipalName}/onenote/sections/{id}/pages` | Create page |

### Personal Contacts — 176 missing of 190

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/me/contactFolders/{id}` | Delete contactFolder |
| DELETE | `/me/contactFolders/{id}/childFolders/{id}/.../contacts/{id}` | Delete contact |
| DELETE | `/me/contactFolders/{id}/contacts/{id}` | Delete contact |
| DELETE | `/me/outlook/masterCategories/{id}` | Delete outlookCategory |
| DELETE | `/users/{id \| userPrincipalName}/contactFolders/{id}` | Delete contactFolder |
| DELETE | `/users/{id \| userPrincipalName}/contactFolders/{id}/childFolders/{id}/contacts/{id}` | Delete contact |
| DELETE | `/users/{id \| userPrincipalName}/contactFolders/{id}/contacts/{id}` | Delete contact |
| DELETE | `/users/{id \| userPrincipalName}/contacts/{id}` | Delete contact |
| DELETE | `/users/{id\|userPrincipalName}/outlook/masterCategories/{id}` | Delete outlookCategory |
| GET | `/devices/{Id}?$expand=extensions($filter=id eq '{extensionId}')&$select=id,{property_1},{property_n}` | Get open extension |
| GET | `/devices/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/groups/{Id}?$expand=extensions($filter=id eq '{extensionId}')&$select=id,{property_1},{property_n}` | Get open extension |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{Id}/events?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/groups/{id}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{id}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{Id}/events/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/groups/{id}/events/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/groups/{id}/events/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{Id}/events/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/groups/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/groups/{Id}/threads/{Id}/posts?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/groups/{id}/threads/{id}/posts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{Id}/threads/{Id}/posts/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/groups/{id}/threads/{id}/posts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/groups/{id}/threads/{id}/posts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/groups/{Id}/threads/{Id}/posts/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/me/calendars?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/calendars/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/calendars/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contactfolders?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contactFolders/{id}` | Get contactFolder |
| GET | `/me/contactfolders/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/contactfolders/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contactFolders/{id}/childFolders` | List childFolders |
| GET | `/me/contactFolders/{id}/childFolders/{id}/.../contacts/{id}` | Get contact |
| GET | `/me/contactFolders/{id}/contacts` | List contacts |
| GET | `/me/contactFolders/{id}/contacts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contactfolders/{Id}/contacts/{id}` | Get contact |
| GET | `/me/contactFolders/{id}/contacts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/contactFolders/{id}/contacts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contactFolders/{id}/contacts/delta` | contact: delta |
| GET | `/me/contacts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/contacts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/contacts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/events/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/events/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/mailFolders/{id}/messages/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/me/messages/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/me/messages/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/me/outlook/masterCategories` | List masterCategories |
| GET | `/me/outlook/masterCategories/{id}` | Get Outlook category |
| GET | `/organization/{Id}?$expand=extensions($filter=id eq '{extensionId}')&$select=id,{property_1},{property_n}` | Get open extension |
| GET | `/organization/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}?$expand=extensions($filter=id eq '{extensionId}')&$select=id,{property_1},{property_n}` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/calendars?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/calendars/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/calendars/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/contactFolders/{id}` | Get contactFolder |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/contactFolders/{id}/childFolders` | List childFolders |
| GET | `/users/{id \| userPrincipalName}/contactFolders/{id}/childFolders/{id}/contacts/{id}` | Get contact |
| GET | `/users/{id \| userPrincipalName}/contactFolders/{id}/contacts` | List contacts |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}/contacts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/contactfolders/{id}/contacts/{id}` | Get contact |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}/contacts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contactFolders/{id}/contacts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/contactFolders/{id}/contacts/delta` | contact: delta |
| GET | `/users/{id \| userPrincipalName}/contacts` | List contacts |
| GET | `/users/{Id\|userPrincipalName}/contacts?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/contacts?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id \| userPrincipalName}/contacts/{id}` | Get contact |
| GET | `/users/{Id\|userPrincipalName}/contacts/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/contacts/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/contacts/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/contacts/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/events?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/events?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/events/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/events/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/events/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/events/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/mailFolders?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/mailFolders/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/mailFolders/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/messages?$filter=Extensions/any(f:f/id eq '{extensionId}')&$expand=Extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and contains(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value eq '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and ep/value ne '{property_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/messages?$filter=singleValueExtendedProperties/Any(ep: ep/id eq '{id_value}' and startswith(ep/value, '{property_value}'))` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/messages/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/messages/{id}?$expand=multiValueExtendedProperties($filter=id eq '{id_value}')` | Get multiValueLegacyExtendedProperty |
| GET | `/users/{id\|userPrincipalName}/messages/{id}?$expand=singleValueExtendedProperties($filter=id eq '{id_value}')` | Get singleValueLegacyExtendedProperty |
| GET | `/users/{Id\|userPrincipalName}/messages/{Id}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{id\|userPrincipalName}/outlook/masterCategories` | List masterCategories |
| GET | `/users/{id\|userPrincipalName}/outlook/masterCategories/{id}` | Get Outlook category |
| GET | `/users/{Id\|userPrincipalName}/todo/lists/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/todo/lists/{todoTaskListId}/extensions/{extensionId}` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{Id}?$expand=extensions($filter=id eq '{extensionId}')` | Get open extension |
| GET | `/users/{Id\|userPrincipalName}/todo/lists/{todoTaskListId}/tasks/{taskId}/extensions/{extensionId}` | Get open extension |
| PATCH | `/groups/{id}/events/{id}` | Create single-value extended property |
| PATCH | `/me/contactFolders/{id}` | Create single-value extended property |
| PATCH | `/me/contactFolders/{id}/childFolders/{id}/.../contacts/{id}` | Update contact |
| PATCH | `/me/contactFolders/{id}/contacts/{id}` | Update contact |
| PATCH | `/me/mailFolders/{id}/messages/{id}` | Create single-value extended property |
| PATCH | `/me/outlook/masterCategories/{id}` | Update outlookCategory |
| PATCH | `/users/{id\|userPrincipalName}/calendars/{id}` | Create single-value extended property |
| PATCH | `/users/{id\|userPrincipalName}/contactFolders/{id}` | Create single-value extended property |
| PATCH | `/users/{id \| userPrincipalName}/contactFolders/{id}/childFolders/{id}/contacts/{id}` | Update contact |
| PATCH | `/users/{id \| userPrincipalName}/contactFolders/{id}/contacts/{id}` | Update contact |
| PATCH | `/users/{id \| userPrincipalName}/contacts/{id}` | Update contact |
| PATCH | `/users/{id\|userPrincipalName}/events/{id}` | Create single-value extended property |
| PATCH | `/users/{id\|userPrincipalName}/mailFolders/{id}` | Create single-value extended property |
| PATCH | `/users/{id\|userPrincipalName}/messages/{id}` | Create single-value extended property |
| PATCH | `/users/{id\|userPrincipalName}/outlook/masterCategories/{id}` | Update outlookCategory |
| POST | `/devices/{id}/extensions` | Create open extension |
| POST | `/groups/{id}/conversations` | Create single-value extended property |
| POST | `/groups/{id}/conversations/{id}/threads/{id}/posts/{id}/reply` | Create single-value extended property |
| POST | `/groups/{id}/conversations/{id}/threads/{id}/reply` | Create single-value extended property |
| POST | `/groups/{id}/events` | Create open extension |
| POST | `/groups/{id}/events/{id}/extensions` | Create open extension |
| POST | `/groups/{id}/extensions` | Create open extension |
| POST | `/groups/{id}/threads` | Create single-value extended property |
| POST | `/groups/{id}/threads/{id}/posts/{id}/extensions` | Create open extension |
| POST | `/groups/{id}/threads/{id}/posts/{id}/reply` | Create open extension |
| POST | `/me/contactFolders` | Create single-value extended property |
| POST | `/me/contactFolders/{id}/childFolders` | Create ContactFolder |
| POST | `/me/contactFolders/{contactFolderId}/contacts` | Create contact |
| POST | `/me/mailFolders/{id}/messages` | Create single-value extended property |
| POST | `/me/outlook/masterCategories` | Create Outlook category |
| POST | `/organization/{id}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/calendars` | Create single-value extended property |
| POST | `/users/{id\|userPrincipalName}/contactFolders` | Create single-value extended property |
| POST | `/users/{id \| userPrincipalName}/contactFolders/{id}/childFolders` | Create ContactFolder |
| POST | `/users/{usersId}/contactFolders/{contactFolderId}/childFolders/{contactFolderId}/permanentDelete` | contactFolder: permanentDelete |
| POST | `/users/{id \| userPrincipalName}/contactFolders/{contactFolderId}/contacts` | Create contact |
| POST | `/users/{usersId}/contactFolders/{contactFolderId}/permanentDelete` | contactFolder: permanentDelete |
| POST | `/users/{id \| userPrincipalName}/contacts` | Create contact |
| POST | `/users/{id\|userPrincipalName}/contacts/{id}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/events` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/events/{id}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/mailFolders` | Create single-value extended property |
| POST | `/users/{id\|userPrincipalName}/messages` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/messages/{id}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/outlook/masterCategories` | Create Outlook category |
| POST | `/users/{id\|userPrincipalName}/todo/lists` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/todo/lists/{id}/extensions` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/todo/lists/{id}/tasks` | Create open extension |
| POST | `/users/{id\|userPrincipalName}/todo/lists/{id}/tasks/{id}/extensions` | Create open extension |

### Search — 15 missing of 16

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/search/acronyms/{acronymsId}` | Delete acronym |
| DELETE | `/search/bookmarks/{bookmarksId}` | Delete bookmark |
| DELETE | `/search/qnas/{qnaId}` | Delete qna |
| GET | `/search/acronyms` | List acronyms |
| GET | `/search/acronyms/{acronymsId}` | Get acronym |
| GET | `/search/bookmarks` | List bookmarks |
| GET | `/search/bookmarks/{bookmarksId}` | Get bookmark |
| GET | `/search/qnas` | List qnas |
| GET | `/search/qnas/{qnaId}` | Get qna |
| PATCH | `/search/acronyms/{acronymsId}` | Update acronym |
| PATCH | `/search/bookmarks/{bookmarksId}` | Update bookmark |
| PATCH | `/search/qnas/{qnaId}` | Update qna |
| POST | `/search/acronyms` | Create acronym |
| POST | `/search/bookmarks` | Create bookmark |
| POST | `/search/qnas` | Create qna |

### Reports — 109 missing of 109

| Method | Graph URL | Description |
|---|---|---|
| GET | `/admin/reportSettings` | Get adminReportSettings |
| GET | `/auditLogs/directoryaudits` | List directoryAudits |
| GET | `/auditLogs/directoryAudits/{id}` | Get directoryAudit |
| GET | `/auditLogs/provisioning` | List provisioningObjectSummary |
| GET | `/auditLogs/signIns` | List signIns |
| GET | `/auditLogs/signIns/{id}` | Get signIn |
| GET | `/reports/authenticationMethods/userRegistrationDetails` | List userRegistrationDetails |
| GET | `/reports/authenticationMethods/userRegistrationDetails/{userId}` | Get userRegistrationDetails |
| GET | `/reports/authenticationMethods/usersRegisteredByFeature` | authenticationMethodsRoot: usersRegisteredByFeature |
| GET | `/reports/authenticationMethods/usersRegisteredByMethod` | authenticationMethodsRoot: usersRegisteredByMethod |
| GET | `/reports/getEmailActivityCounts(period='{period_value}')` | reportRoot: getEmailActivityCounts |
| GET | `/reports/getEmailActivityUserCounts(period='{period_value}')` | reportRoot: getEmailActivityUserCounts |
| GET | `/reports/getEmailActivityUserDetail(date={date_value})` | reportRoot: getEmailActivityUserDetail |
| GET | `/reports/getEmailActivityUserDetail(period='{period_value}')` | reportRoot: getEmailActivityUserDetail |
| GET | `/reports/getEmailAppUsageAppsUserCounts(period='{period_value}')` | reportRoot: getEmailAppUsageAppsUserCounts |
| GET | `/reports/getEmailAppUsageUserCounts(period='{period_value}')` | reportRoot: getEmailAppUsageUserCounts |
| GET | `/reports/getEmailAppUsageUserDetail(date={date_value})` | reportRoot: getEmailAppUsageUserDetail |
| GET | `/reports/getEmailAppUsageUserDetail(period='{period_value}')` | reportRoot: getEmailAppUsageUserDetail |
| GET | `/reports/getEmailAppUsageVersionsUserCounts(period='{period_value}')` | reportRoot: getEmailAppUsageVersionsUserCounts |
| GET | `/reports/getM365AppPlatformUserCounts(period='{period_value}')` | reportRoot: getM365AppPlatformUserCounts |
| GET | `/reports/getM365AppUserCounts(period='{period_value}')` | reportRoot: getM365AppUserCounts |
| GET | `/reports/getM365AppUserDetail(date='{date_value}')` | reportRoot: getM365AppUserDetail |
| GET | `/reports/getM365AppUserDetail(period='{period_value}')` | reportRoot: getM365AppUserDetail |
| GET | `/reports/getMailboxUsageDetail(period='{period_value}')` | reportRoot: getMailboxUsageDetail |
| GET | `/reports/getMailboxUsageMailboxCounts(period='{period_value}')` | reportRoot: getMailboxUsageMailboxCounts |
| GET | `/reports/getMailboxUsageQuotaStatusMailboxCounts(period='{period_value}')` | reportRoot: getMailboxUsageQuotaStatusMailboxCounts |
| GET | `/reports/getMailboxUsageStorage(period='{period_value}')` | reportRoot: getMailboxUsageStorage |
| GET | `/reports/getOffice365ActivationCounts` | reportRoot: getOffice365ActivationCounts |
| GET | `/reports/getOffice365ActivationsUserCounts` | reportRoot: getOffice365ActivationsUserCounts |
| GET | `/reports/getOffice365ActivationsUserDetail` | reportRoot: getOffice365ActivationsUserDetail |
| GET | `/reports/getOffice365ActiveUserCounts(period='{period_value}')` | reportRoot: getOffice365ActiveUserCounts |
| GET | `/reports/getOffice365ActiveUserDetail(date={date_value})` | reportRoot: getOffice365ActiveUserDetail |
| GET | `/reports/getOffice365ActiveUserDetail(period='{period_value}')` | reportRoot: getOffice365ActiveUserDetail |
| GET | `/reports/getOffice365GroupsActivityCounts(period='{period_value}')` | reportRoot: getOffice365GroupsActivityCounts |
| GET | `/reports/getOffice365GroupsActivityDetail(date={date_value})` | reportRoot: getOffice365GroupsActivityDetail |
| GET | `/reports/getOffice365GroupsActivityDetail(period='{period_value}')` | reportRoot: getOffice365GroupsActivityDetail |
| GET | `/reports/getOffice365GroupsActivityFileCounts(period='{period_value}')` | reportRoot: getOffice365GroupsActivityFileCounts |
| GET | `/reports/getOffice365GroupsActivityGroupCounts(period='{period_value}')` | reportRoot: getOffice365GroupsActivityGroupCounts |
| GET | `/reports/getOffice365GroupsActivityStorage(period='{period_value}')` | reportRoot: getOffice365GroupsActivityStorage |
| GET | `/reports/getOffice365ServicesUserCounts(period='{period_value}')` | reportRoot: getOffice365ServicesUserCounts |
| GET | `/reports/getOneDriveActivityFileCounts(period='{period_value}')` | reportRoot: getOneDriveActivityFileCounts |
| GET | `/reports/getOneDriveActivityUserCounts(period='{period_value}')` | reportRoot: getOneDriveActivityUserCounts |
| GET | `/reports/getOneDriveActivityUserDetail(date={date_value})` | reportRoot: getOneDriveActivityUserDetail |
| GET | `/reports/getOneDriveActivityUserDetail(period='{period_value}')` | reportRoot: getOneDriveActivityUserDetail |
| GET | `/reports/getOneDriveUsageAccountCounts(period='{period_value}')` | reportRoot: getOneDriveUsageAccountCounts |
| GET | `/reports/getOneDriveUsageAccountDetail(date={date_value})` | reportRoot: getOneDriveUsageAccountDetail |
| GET | `/reports/getOneDriveUsageAccountDetail(period='{period_value}')` | reportRoot: getOneDriveUsageAccountDetail |
| GET | `/reports/getOneDriveUsageFileCounts(period='{period_value}')` | reportRoot: getOneDriveUsageFileCounts |
| GET | `/reports/getOneDriveUsageStorage(period='{period_value}')` | reportRoot: getOneDriveUsageStorage |
| GET | `/reports/getRelyingPartyDetailedSummary(period='parameterValue')` | reportRoot: getRelyingPartyDetailedSummary |
| GET | `/reports/getSharePointActivityFileCounts(period='{period_value}')` | reportRoot: getSharePointActivityFileCounts |
| GET | `/reports/getSharePointActivityPages(period='{period_value}')` | reportRoot: getSharePointActivityPages |
| GET | `/reports/getSharePointActivityUserCounts(period='{period_value}')` | reportRoot: getSharePointActivityUserCounts |
| GET | `/reports/getSharePointActivityUserDetail(date={date_value})` | reportRoot: getSharePointActivityUserDetail |
| GET | `/reports/getSharePointActivityUserDetail(period='{period_value}')` | reportRoot: getSharePointActivityUserDetail |
| GET | `/reports/getSharePointSiteUsageDetail(date={date_value})` | reportRoot: getSharePointSiteUsageDetail |
| GET | `/reports/getSharePointSiteUsageDetail(period='{period_value}')` | reportRoot: getSharePointSiteUsageDetail |
| GET | `/reports/getSharePointSiteUsageFileCounts(period='{period_value}')` | reportRoot: getSharePointSiteUsageFileCounts |
| GET | `/reports/getSharePointSiteUsagePages(period='{period_value}')` | reportRoot: getSharePointSiteUsagePages |
| GET | `/reports/getSharePointSiteUsageSiteCounts(period='{period_value}')` | reportRoot: getSharePointSiteUsageSiteCounts |
| GET | `/reports/getSharePointSiteUsageStorage(period='{period_value}')` | reportRoot: getSharePointSiteUsageStorage |
| GET | `/reports/getSkypeForBusinessActivityCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessActivityCounts |
| GET | `/reports/getSkypeForBusinessActivityUserCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessActivityUserCounts |
| GET | `/reports/getSkypeForBusinessActivityUserDetail(date={date_value})` | reportRoot: getSkypeForBusinessActivityUserDetail |
| GET | `/reports/getSkypeForBusinessActivityUserDetail(period='{period_value}')` | reportRoot: getSkypeForBusinessActivityUserDetail |
| GET | `/reports/getSkypeForBusinessDeviceUsageDistributionUserCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessDeviceUsageDistributionUserCounts |
| GET | `/reports/getSkypeForBusinessDeviceUsageUserCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessDeviceUsageUserCounts |
| GET | `/reports/getSkypeForBusinessDeviceUsageUserDetail(date={date_value})` | reportRoot: getSkypeForBusinessDeviceUsageUserDetail |
| GET | `/reports/getSkypeForBusinessDeviceUsageUserDetail(period='{period_value}')` | reportRoot: getSkypeForBusinessDeviceUsageUserDetail |
| GET | `/reports/getSkypeForBusinessOrganizerActivityCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessOrganizerActivityCounts |
| GET | `/reports/getSkypeForBusinessOrganizerActivityMinuteCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessOrganizerActivityMinuteCounts |
| GET | `/reports/getSkypeForBusinessOrganizerActivityUserCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessOrganizerActivityUserCounts |
| GET | `/reports/getSkypeForBusinessParticipantActivityCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessParticipantActivityCounts |
| GET | `/reports/getSkypeForBusinessParticipantActivityMinuteCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessParticipantActivityMinuteCounts |
| GET | `/reports/getSkypeForBusinessParticipantActivityUserCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessParticipantActivityUserCounts |
| GET | `/reports/getSkypeForBusinessPeerToPeerActivityCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessPeerToPeerActivityCounts |
| GET | `/reports/getSkypeForBusinessPeerToPeerActivityMinuteCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessPeerToPeerActivityMinuteCounts |
| GET | `/reports/getSkypeForBusinessPeerToPeerActivityUserCounts(period='{period_value}')` | reportRoot: getSkypeForBusinessPeerToPeerActivityUserCounts |
| GET | `/reports/getTeamsDeviceUsageDistributionUserCounts(period='{period_value}')` | reportRoot: getTeamsDeviceUsageDistributionUserCounts |
| GET | `/reports/getTeamsDeviceUsageUserCounts(period='{period_value}')` | reportRoot: getTeamsDeviceUsageUserCounts |
| GET | `/reports/getTeamsDeviceUsageUserDetail(date='{date_value}')` | reportRoot: getTeamsDeviceUsageUserDetail |
| GET | `/reports/getTeamsDeviceUsageUserDetail(period='{period_value}')` | reportRoot: getTeamsDeviceUsageUserDetail |
| GET | `/reports/getTeamsTeamActivityCounts(period='{period_value}')` | reportRoot: getTeamsTeamActivityCounts |
| GET | `/reports/getTeamsTeamActivityDetail(period='{period_value}')` | reportRoot: getTeamsTeamActivityDetail |
| GET | `/reports/getTeamsTeamActivityDistributionCounts(period='{period_value}')` | reportRoot: getTeamsTeamActivityDistributionCounts |
| GET | `/reports/getTeamsTeamCounts(period='{period_value}')` | reportRoot: getTeamsTeamCounts |
| GET | `/reports/getTeamsUserActivityCounts(period='{period_value}')` | reportRoot: getTeamsUserActivityCounts |
| GET | `/reports/getTeamsUserActivityUserCounts(period='{period_value}')` | reportRoot: getTeamsUserActivityUserCounts |
| GET | `/reports/getTeamsUserActivityUserDetail(date={date_value})` | reportRoot: getTeamsUserActivityUserDetail |
| GET | `/reports/getTeamsUserActivityUserDetail(period='{period_value}')` | reportRoot: getTeamsUserActivityUserDetail |
| GET | `/reports/getYammerActivityCounts(period='{period_value}')` | reportRoot: getYammerActivityCounts |
| GET | `/reports/getYammerActivityUserCounts(period='{period_value}')` | reportRoot: getYammerActivityUserCounts |
| GET | `/reports/getYammerActivityUserDetail(date={date_value})` | reportRoot: getYammerActivityUserDetail |
| GET | `/reports/getYammerActivityUserDetail(period='{period_value}')` | reportRoot: getYammerActivityUserDetail |
| GET | `/reports/getYammerDeviceUsageDistributionUserCounts(period='{period_value}')` | reportRoot: getYammerDeviceUsageDistributionUserCounts |
| GET | `/reports/getYammerDeviceUsageUserCounts(period='{period_value}')` | reportRoot: getYammerDeviceUsageUserCounts |
| GET | `/reports/getYammerDeviceUsageUserDetail(date={date_value})` | reportRoot: getYammerDeviceUsageUserDetail function |
| GET | `/reports/getYammerDeviceUsageUserDetail(period='{period_value}')` | reportRoot: getYammerDeviceUsageUserDetail function |
| GET | `/reports/getYammerGroupsActivityCounts(period='{period_value}')` | reportRoot: getYammerGroupsActivityCounts |
| GET | `/reports/getYammerGroupsActivityDetail(date={date_value})` | reportRoot: getYammerGroupsActivityDetail |
| GET | `/reports/getYammerGroupsActivityDetail(period='{period_value}')` | reportRoot: getYammerGroupsActivityDetail |
| GET | `/reports/getYammerGroupsActivityGroupCounts(period='{period_value}')` | reportRoot: getYammerGroupsActivityGroupCounts |
| GET | `/reports/security/getAttackSimulationRepeatOffenders` | securityReportsRoot: getAttackSimulationRepeatOffenders |
| GET | `/reports/security/getAttackSimulationSimulationUserCoverage` | securityReportsRoot: getAttackSimulationSimulationUserCoverage |
| GET | `/reports/security/getAttackSimulationTrainingUserCoverage` | securityReportsRoot: getAttackSimulationTrainingUserCoverage |
| PATCH | `/admin/reportSettings` | Update adminReportSettings |
| POST | `/auditLogs/signIns/confirmCompromised` | signIn: confirmCompromised |
| POST | `/auditLogs/signIns/confirmSafe` | signIn: confirmSafe |
| POST | `/auditLogs/signIns/dismiss` | signIn: dismiss |

### Security — 312 missing of 312

| Method | Graph URL | Description |
|---|---|---|
| DELETE | `/security/attackSimulation/simulations/{simulationId}` | Delete simulation |
| DELETE | `/security/cases/ediscoveryCases/{ediscoveryCaseId}` | Delete ediscoveryCase |
| DELETE | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/caseMembers/{eDiscoveryCaseMemberId}` | Remove ediscoveryCaseMember |
| DELETE | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{ediscoveryCustodianId}/siteSources/{siteSourceId}` | Delete siteSource |
| DELETE | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{ediscoveryCustodianId}/unifiedGroupSources/{unifiedGroupSourceId}` | Delete unifiedGroupSource |
| DELETE | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{ediscoveryCustodianId}/userSources/{userSourceId}` | Delete userSource |
| DELETE | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/legalHolds/{ediscoveryHoldPolicyId}` | Delete ediscoveryHoldPolicy |
| DELETE | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/legalHolds/{ediscoveryHoldPolicyId}/siteSources/{siteSourceId}` | Delete siteSource |
| DELETE | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/legalHolds/{ediscoveryHoldPolicyId}/userSources/{userSourceId}` | Delete userSource |
| DELETE | `/security/cases/ediscoveryCases/{eDiscoveryCaseId}/reviewSets/{ediscoveryReviewSetId}/queries/{eDiscoveryReviewSetQueryId}` | Delete ediscoveryReviewSetQuery |
| DELETE | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}` | Delete ediscoverySearch |
| DELETE | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/custodianSources/{id}/$ref` | Remove custodianSources |
| DELETE | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/noncustodialSources/{id}/$ref` | Remove noncustodialSources |
| DELETE | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/tags/{tagId}` | Remove ediscoveryReviewTag |
| DELETE | `/security/identities/sensors/{sensorId}` | Delete sensor |
| DELETE | `/security/labels/authorities/{authorityTemplateId}/$ref` | Delete authorityTemplate |
| DELETE | `/security/labels/categories/{categoryTemplateId}/$ref` | Delete categoryTemplate |
| DELETE | `/security/labels/categories/{categoryTemplateId}/subcategories/{subcategoryTemplateId}/$ref` | Delete subcategoryTemplate |
| DELETE | `/security/labels/citations/{citationTemplateId}/$ref` | Delete citationTemplate |
| DELETE | `/security/labels/departments/{departmentTemplateId}/$ref` | Delete departmentTemplate |
| DELETE | `/security/labels/filePlanReferences/{filePlanReferenceTemplateId}/$ref` | Delete filePlanReferenceTemplate |
| DELETE | `/security/labels/retentionLabels/{retentionLabelId}` | Delete retentionLabel |
| DELETE | `/security/labels/retentionLabels/{retentionLabelId}/descriptors/authorityTemplate/$ref` | Delete authorityTemplate |
| DELETE | `/security/labels/retentionLabels/{retentionLabelId}/descriptors/categoryTemplate/$ref` | Delete categoryTemplate |
| DELETE | `/security/labels/retentionLabels/{retentionLabelId}/descriptors/citationTemplate/$ref` | Delete citationTemplate |
| DELETE | `/security/labels/retentionLabels/{retentionLabelId}/descriptors/departmentTemplate/$ref` | Delete departmentTemplate |
| DELETE | `/security/labels/retentionLabels/{retentionLabelId}/descriptors/filePlanReferenceTemplate/$ref` | Delete filePlanReferenceTemplate |
| DELETE | `/security/labels/retentionLabels/{retentionLabelId}/eventType/$ref` | Delete retentionEventType |
| DELETE | `/security/triggers/retentionEvents/{retentionEventId}` | Delete retentionEvent |
| DELETE | `/security/triggers/retentionEvents/{retentionEventId}/retentionEventType/$ref` | Delete retentionEventType |
| DELETE | `/security/triggerTypes/retentionEventTypes/{retentionEventTypeId}/$ref` | Delete retentionEventType |
| GET | `/informationProtection/threatAssessmentRequests` | List threatAssessmentRequests |
| GET | `/informationProtection/threatAssessmentRequests/{id}` | Get threatAssessmentRequest |
| GET | `/reports/security/getAttackSimulationRepeatOffenders` | securityReportsRoot: getAttackSimulationRepeatOffenders |
| GET | `/reports/security/getAttackSimulationSimulationUserCoverage` | securityReportsRoot: getAttackSimulationSimulationUserCoverage |
| GET | `/reports/security/getAttackSimulationTrainingUserCoverage` | securityReportsRoot: getAttackSimulationTrainingUserCoverage |
| GET | `/security/alerts` | List alerts (deprecated) |
| GET | `/security/alerts_v2` | List alerts_v2 |
| GET | `/security/alerts_v2?$filter={property}+eq+'{property-value}'` | List alerts_v2 |
| GET | `/security/alerts_V2?$top=100&$skip=200` | List alerts_v2 |
| GET | `/security/alerts_v2/{alertId}` | Get alert |
| GET | `/security/alerts?$filter={property} eq '{property-value}'` | List alerts (deprecated) |
| GET | `/security/alerts?$filter={property} eq '{property-value}' and {property} eq '{property-value}'` | List alerts (deprecated) |
| GET | `/security/alerts?$filter={property} eq '{property-value}'&$top=5` | List alerts (deprecated) |
| GET | `/security/alerts?$top=1` | List alerts (deprecated) |
| GET | `/security/alerts/{alert_id}` | Get alert (deprecated) |
| GET | `/security/attackSimulation/endUserNotifications` | Get endUserNotification |
| GET | `/security/attackSimulation/endUserNotifications?$filter=source eq 'tenant'` | List endUserNotifications |
| GET | `/security/attackSimulation/landingPages?$filter=source eq 'tenant'` | List landingPages |
| GET | `/security/attackSimulation/landingPages/{landingPageId}` | Get landingPage |
| GET | `/security/attackSimulation/loginPages?$filter=source eq 'tenant'` | List loginPages |
| GET | `/security/attackSimulation/loginPages/{loginPageId}` | Get loginPage |
| GET | `/security/attackSimulation/operations/{operationsId}` | Get attackSimulationOperation |
| GET | `/security/attackSimulation/payloads/{payloadId}` | Get payload |
| GET | `/security/attackSimulation/payloads/{payloadId}/detail` | Get payloadDetail |
| GET | `/security/attackSimulation/simulationAutomations` | List simulationAutomations |
| GET | `/security/attackSimulation/simulationAutomations?$count=true` | List simulationAutomations |
| GET | `/security/attackSimulation/simulationAutomations?$orderby={property}` | List simulationAutomations |
| GET | `/security/attackSimulation/simulationAutomations?$select={property}` | List simulationAutomations |
| GET | `/security/attackSimulation/simulationAutomations?$skip={skipCount}` | List simulationAutomations |
| GET | `/security/attackSimulation/simulationAutomations?$top=1` | List simulationAutomations |
| GET | `/security/attackSimulation/simulationAutomations/{simulationAutomationId}` | Get simulationAutomation |
| GET | `/security/attackSimulation/simulationAutomations/{simulationAutomationId}/runs` | List runs |
| GET | `/security/attackSimulation/simulationAutomations/{simulationAutomationId}/runs?$count=true` | List runs |
| GET | `/security/attackSimulation/simulationAutomations/{simulationAutomationId}/runs?$select={property}` | List runs |
| GET | `/security/attackSimulation/simulationAutomations/{simulationAutomationId}/runs?$skipToken={skipToken}` | List runs |
| GET | `/security/attackSimulation/simulationAutomations/{simulationAutomationId}/runs?$top=1` | List runs |
| GET | `/security/attackSimulation/simulations` | List simulations |
| GET | `/security/attackSimulation/simulations?$count=true` | List simulations |
| GET | `/security/attackSimulation/simulations?$orderby={property}` | List simulations |
| GET | `/security/attackSimulation/simulations?$select={property}` | List simulations |
| GET | `/security/attackSimulation/simulations?$skipToken={skipToken}` | List simulations |
| GET | `/security/attackSimulation/simulations?$top=1` | List simulations |
| GET | `/security/attackSimulation/simulations/{simulationId}` | Get simulation |
| GET | `/security/attackSimulation/simulations/{simulationId}/landingPage` | Get landingPage |
| GET | `/security/attackSimulation/simulations/{simulationId}/loginPage` | Get loginPage |
| GET | `/security/attackSimulation/simulations/{simulationId}/payload` | Get payload |
| GET | `/security/attackSimulation/simulations/{simulationId}/report/simulationUsers` | List simulationUsers |
| GET | `/security/attackSimulation/simulations/{simulationId}/report/simulationUsers?$count=true` | List simulationUsers |
| GET | `/security/attackSimulation/simulations/{simulationId}/report/simulationUsers?$skipToken={skipToken}` | List simulationUsers |
| GET | `/security/attackSimulation/simulations/{simulationId}/report/simulationUsers?$top=1` | List simulationUsers |
| GET | `/security/attackSimulation/trainings` | List trainings |
| GET | `/security/attackSimulation/trainings/{trainingId}` | Get training |
| GET | `/security/attackSimulation/trainings/{trainingId}/languageDetails/{trainingLanguageDetailId}?$filter=locale eq 'locale'` | Get trainingLanguageDetail |
| GET | `/security/auditLog/queries` | List auditLogQueries |
| GET | `/security/auditLog/queries/{auditLogQueryId}/records` | List auditLogRecords |
| GET | `/security/cases/ediscoveryCases` | List ediscoveryCases |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}` | Get ediscoveryCase |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/caseMembers` | List ediscoveryCaseMember objects |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians` | List ediscoveryCustodian |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{ediscoveryCustodianId}` | Get ediscoveryCustodian |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{ediscoverycustodianId}/lastIndexOperation` | List lastIndexOperation |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{custodianId}/siteSources` | List siteSources |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{custodianId}/unifiedGroupSources` | List custodian's unifiedGroupSources |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{custodianId}/userSources` | List userSources |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/legalHolds` | List ediscoveryHoldPolicies |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/legalHolds/{ediscoveryHoldPolicyId}` | Get ediscoveryHoldPolicy |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/legalHolds/{ediscoveryHoldPolicyId}/siteSources` | List siteSources |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/legalHolds/{ediscoveryHoldPolicyId}/userSources` | List userSources |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/noncustodialDataSources/{ediscoveryNoncustodialDataSourceId}` | Get ediscoveryNoncustodialDataSource |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/noncustodialSources/{ediscoveryNoncustodialDataSourceId}/lastIndexOperation` | List lastIndexOperation |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/operations` | List caseOperations |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/operations/{caseOperationId}` | Get caseOperation |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets` | List reviewSets |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets/{reviewSetId}` | Get ediscoveryReviewSet |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets/{ediscoveryReviewSetId}/files/{ediscoveryFileId}/tags/{ediscoveryReviewTagId}` | Get ediscoveryReviewTag |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets/{ediscoveryReviewSetId}/files/{ediscoveryFileId}/tags/{ediscoveryReviewTagId}/childTags/{ediscoveryReviewTagId}` | Get ediscoveryReviewTag |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets/{ediscoveryReviewSetId}/files/{ediscoveryFileId}/tags/{ediscoveryReviewTagId}/parent` | Get ediscoveryReviewTag |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets/{ediscoveryReviewSetId}/queries` | List queries |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets/{ediscoveryReviewSetId}/queries/{queryId}` | Get ediscoveryReviewSetQuery |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches` | List searches |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}` | Get ediscoverySearch |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/additionalSources` | List additionalSources |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/custodianSources` | List custodianSources |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/lastEstimateStatisticsOperation` | List lastEstimateStatisticsOperation |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/noncustodialSources` | List noncustodialSources |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/settings` | Get ediscoveryCaseSettings |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/tags` | List tags |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/tags/{ediscoveryReviewTagId}` | Get ediscoveryReviewTag |
| GET | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/tags/asHierarchy` | ediscoveryReviewTag: asHierarchy |
| GET | `/security/dataSecurityAndGovernance/sensitivityLabels` | List sensitivityLabels |
| GET | `/security/dataSecurityAndGovernance/sensitivityLabels/{labelId}` | Get sensitivityLabel |
| GET | `/security/dataSecurityAndGovernance/sensitivityLabels/{labelId}/rights` | Get usageRightsIncluded |
| GET | `/security/dataSecurityAndGovernance/sensitivityLabels/computeInheritance` | sensitivityLabel: computeInheritance |
| GET | `/security/identities/healthIssues` | List healthIssues |
| GET | `/security/identities/healthIssues?$filter=Status eq 'open'` | List healthIssues |
| GET | `/security/identities/healthIssues?$filter=Status eq 'open' and healthIssueType eq 'global'` | List healthIssues |
| GET | `/security/identities/healthissues?$filter=Status eq 'open' and healthIssueType eq 'global' and domainNames/any(s:endswith(s,'contoso.com'))` | List healthIssues |
| GET | `/security/identities/healthissues?$filter=Status eq 'open' and healthIssueType eq 'global' and sensorDNSNames/any(s:endswith(s,'contoso.com'))` | List healthIssues |
| GET | `/security/identities/healthIssues?$filter=Status eq 'open' and healthIssueType eq 'sensor'` | List healthIssues |
| GET | `/security/identities/healthIssues?$filter=Status eq 'open' and severity eq 'low'` | List healthIssues |
| GET | `/security/identities/healthIssues?$filter=Status eq 'open' and severity eq 'medium'` | List healthIssues |
| GET | `/security/identities/healthIssues?$filter=Status eq 'open'&$top=5` | List healthIssues |
| GET | `/security/identities/healthIssues/{healthIssueId}` | Get healthIssue |
| GET | `/security/identities/identityAccounts` | List identityAccounts objects |
| GET | `/security/identities/identityAccounts/{identityAccountsId}` | Get identityAccounts |
| GET | `/security/identities/sensorCandidateActivationConfiguration` | Get sensorCandidateActivationConfiguration |
| GET | `/security/identities/sensorCandidates` | List sensorCandidate objects |
| GET | `/security/identities/sensors` | List sensors |
| GET | `/security/identities/sensors/{sensorId}` | Get sensor |
| GET | `/security/identities/sensors/getDeploymentAccessKey` | sensor: getDeploymentAccessKey |
| GET | `/security/identities/sensors/getDeploymentPackageUri` | sensor: getDeploymentPackageUri |
| GET | `/security/identities/settings/autoAuditingConfiguration` | Get autoAuditingConfiguration |
| GET | `/security/incidents` | List incidents |
| GET | `/security/incidents?$count=true` | List incidents |
| GET | `/security/incidents?$filter={property}+eq+'{property-value}'` | List incidents |
| GET | `/security/incidents?$top=10` | List incidents |
| GET | `/security/incidents/{incidentId}` | Get incident |
| GET | `/security/labels/authorities` | List authorityTemplates |
| GET | `/security/labels/authorities/{authorityTemplateId}` | Get authorityTemplate |
| GET | `/security/labels/categories` | List categoryTemplates |
| GET | `/security/labels/categories/{categoryTemplateId}` | Get categoryTemplate |
| GET | `/security/labels/categories/{categoryTemplateId}/subcategories` | List subcategories |
| GET | `/security/labels/categories/{categoryTemplateId}/subcategories/{subcategoryTemplateId}` | Get subcategoryTemplate |
| GET | `/security/labels/citations` | List citationTemplates |
| GET | `/security/labels/citations/{citationTemplateId}` | Get citationTemplate |
| GET | `/security/labels/departments` | List departmentTemplates |
| GET | `/security/labels/departments/{departmentTemplateId}` | Get departmentTemplate |
| GET | `/security/labels/filePlanReferences` | List filePlanReferenceTemplates |
| GET | `/security/labels/filePlanReferences/{filePlanReferenceTemplateId}` | Get filePlanReferenceTemplate |
| GET | `/security/labels/retentionLabels` | List retentionLabels |
| GET | `/security/labels/retentionLabels/{retentionLabelId}` | Get retentionLabel |
| GET | `/security/labels/retentionLabels/{retentionLabelId}/descriptors/authorityTemplate` | Get authorityTemplate |
| GET | `/security/labels/retentionLabels/{retentionLabelId}/descriptors/categoryTemplate` | Get categoryTemplate |
| GET | `/security/labels/retentionLabels/{retentionLabelId}/descriptors/citationTemplate` | Get citationTemplate |
| GET | `/security/labels/retentionLabels/{retentionLabelId}/descriptors/departmentTemplate` | Get departmentTemplate |
| GET | `/security/labels/retentionLabels/{retentionLabelId}/descriptors/filePlanReferenceTemplate` | Get filePlanReferenceTemplate |
| GET | `/security/labels/retentionLabels/{retentionLabelId}/eventType` | Get retentionEventType |
| GET | `/security/secureScoreControlProfiles` | List secureScoreControlProfiles |
| GET | `/security/secureScoreControlProfiles?$filter={property} eq '{property-value}'` | List secureScoreControlProfiles |
| GET | `/security/secureScoreControlProfiles?$top=1` | List secureScoreControlProfiles |
| GET | `/security/secureScoreControlProfiles/{id}` | Get secureScoreControlProfile |
| GET | `/security/secureScores` | List secureScores |
| GET | `/security/secureScores?$filter={property} eq '{property-value}'` | List secureScores |
| GET | `/security/secureScores?$top=1` | List secureScores |
| GET | `/security/secureScores?$top=1&$skip=7` | List secureScores |
| GET | `/security/secureScores/{id}` | Get secureScore |
| GET | `/security/threatIntelligence/articleIndicators/{articleIndicatorId}` | Get articleIndicator |
| GET | `/security/threatIntelligence/articles` | List articles |
| GET | `/security/threatIntelligence/articles/{articleId}` | Get article |
| GET | `/security/threatIntelligence/articles/{articleId}/indicators` | List indicators |
| GET | `/security/threatIntelligence/hostComponents/{hostComponentId}` | Get hostComponent |
| GET | `/security/threatIntelligence/hostCookies/{hostCookieId}` | Get hostCookie |
| GET | `/security/threatIntelligence/hostPairs/{hostPairId}` | Get hostPair |
| GET | `/security/threatIntelligence/hostPorts/{hostPortId}` | Get hostPort |
| GET | `/security/threatIntelligence/hosts/{hostId}` | Get host |
| GET | `/security/threatIntelligence/hosts/{hostId}/childHostPairs` | List childHostPairs |
| GET | `/security/threatIntelligence/hosts/{hostId}/components` | List components |
| GET | `/security/threatIntelligence/hosts/{hostId}/cookies` | List cookies |
| GET | `/security/threatIntelligence/hosts/{hostId}/hostPairs` | List hostPairs |
| GET | `/security/threatIntelligence/hosts/{hostId}/parentHostPairs` | List parentHostPairs |
| GET | `/security/threatIntelligence/hosts/{hostId}/passiveDns` | List passiveDns |
| GET | `/security/threatIntelligence/hosts/{hostId}/passiveDnsReverse` | List passiveDnsReverse |
| GET | `/security/threatIntelligence/hosts/{hostId}/ports` | List hostPorts |
| GET | `/security/threatIntelligence/hosts/{hostId}/reputation` | Get hostReputation |
| GET | `/security/threatIntelligence/hosts/{hostId}/sslCertificates` | List hostSslCertificates |
| GET | `/security/threatIntelligence/hosts/{hostId}/subdomains` | List subdomains |
| GET | `/security/threatIntelligence/hosts/{hostId}/trackers` | List trackers |
| GET | `/security/threatIntelligence/hosts/{hostId}/whois` | Get whoisRecord |
| GET | `/security/threatIntelligence/hosts/{hostId}/whois/history` | List history |
| GET | `/security/threatIntelligence/hostSslCertificates/{hostSslCertificateId}` | Get hostSslCertificate |
| GET | `/security/threatIntelligence/hostTrackers/{hostTrackerId}` | Get hostTracker |
| GET | `/security/threatIntelligence/intelligenceProfileIndicators/{intelligenceProfileIndicatorId}` | Get intelligenceProfileIndicator |
| GET | `/security/threatIntelligence/intelProfiles` | List intelProfiles |
| GET | `/security/threatIntelligence/intelProfiles/{intelligenceProfileId}` | Get intelligenceProfile |
| GET | `/security/threatIntelligence/intelProfiles/{intelligenceProfileId}/indicators` | List indicators |
| GET | `/security/threatIntelligence/passiveDnsRecords/{passiveDnsRecordId}` | Get passiveDnsRecord |
| GET | `/security/threatIntelligence/sslCertificates?$search="{property_name}:{property_value}"` | List sslCertificates |
| GET | `/security/threatIntelligence/sslCertificates/{sslCertificateId}` | Get sslCertificate |
| GET | `security/threatIntelligence/sslCertificates/{sslCertificateId}/relatedHosts` | List relatedHosts |
| GET | `/security/threatIntelligence/subdomains/{subdomainId}` | Get subdomain |
| GET | `/security/threatIntelligence/vulnerabilities/{vulnerabilityId}` | Get vulnerability |
| GET | `/security/threatIntelligence/vulnerabilities/{vulnerabilityId}/components` | List components |
| GET | `/security/threatIntelligence/vulnerabilities/{vulnerabilityId}/components/{vulnerabilityComponentId}` | Get vulnerabilityComponent |
| GET | `/security/threatIntelligence/whoisHistoryRecord/{whoisHistoryRecordId}` | Get whoisHistoryRecord |
| GET | `/security/threatIntelligence/whoisRecords?$search="{value}"` | List whoisRecords |
| GET | `/security/threatIntelligence/whoisRecords/{whoisRecordId}` | Get whoisRecord |
| GET | `/security/threatIntelligence/whoisRecords/{id}/history` | List history |
| GET | `/security/triggers/retentionEvents` | List retentionEvents |
| GET | `/security/triggers/retentionEvents/{retentionEventId}` | Get retentionEvent |
| GET | `/security/triggers/retentionEvents/{retentionEventId}/labels/{retentionLabelId}` | Get retentionLabel |
| GET | `/security/triggers/retentionEvents/{retentionEventId}/retentionEventType` | Get retentionEventType |
| GET | `/security/triggerTypes/retentionEventTypes` | List retentionEventTypes |
| GET | `/security/triggerTypes/retentionEventTypes/{retentionEventTypeId}` | Get retentionEventType |
| PATCH | `/security/alerts_v2/{alertId}` | Update alert |
| PATCH | `/security/alerts/{alert_id}` | Update alert (deprecated) |
| PATCH | `/security/attackSimulation/simulations/{simulationId}` | Update simulation |
| PATCH | `/security/cases/ediscoveryCases/{ediscoveryCaseId}` | Update ediscoveryCase |
| PATCH | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/legalHolds/{ediscoveryHoldPolicyId}` | Update ediscoveryHoldPolicy |
| PATCH | `/security/cases/ediscoveryCases/{ediscoverycaseId}/reviewSets/{reviewSetId}` | Update ediscoveryReviewSet |
| PATCH | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets/{ediscoveryReviewSetId}/queries/{queryId}` | Update ediscoveryReviewSetQuery |
| PATCH | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}` | Update ediscoverySearch |
| PATCH | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/settings` | Update ediscoveryCaseSettings |
| PATCH | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/tags/{ediscoveryReviewTagId}` | Update ediscoveryReviewTag |
| PATCH | `/security/identities/healthIssues/{healthIssueId}` | Update healthIssue |
| PATCH | `/security/identities/sensors/{sensorId}` | Update sensor |
| PATCH | `/security/identities/settings/autoAuditingConfiguration` | Update autoAuditingConfiguration |
| PATCH | `/security/incidents/{incidentId}` | Update incident |
| PATCH | `/security/labels/retentionLabels/{retentionLabelId}` | Update retentionLabel |
| PATCH | `/security/labels/retentionLabels/{retentionLabelId}/eventType` | Update retentionEventType |
| PATCH | `/security/secureScoreControlProfiles/{id}` | Update secureScoreControlProfile |
| PATCH | `/security/triggers/retentionEvents/{retentionEventId}/retentionEventType` | Update retentionEventType |
| PATCH | `/security/triggerTypes/retentionEventTypes/{retentionEventTypeId}` | Update retentionEventType |
| POST | `/informationProtection/threatAssessmentRequests` | Create threatAssessmentRequest |
| POST | `/me/dataSecurityAndGovernance/activities/contentActivities` | Create contentActivity |
| POST | `/me/dataSecurityAndGovernance/processContent` | userDataSecurityAndGovernance: processContent |
| POST | `/security/alerts_v2/{alertId}/comments` | Create comment for alert |
| POST | `/security/attackSimulation/simulations` | Create simulation |
| POST | `/security/auditLog/queries` | Create auditLogQuery |
| POST | `/security/cases/ediscoveryCases` | Create ediscoveryCase |
| POST | `/security/cases/ediscoveryCases('{ediscoveryCaseId}')/searches('{ediscoverySearchId}')/exportReport` | ediscoverySearch: exportReport |
| POST | `/security/cases/ediscoveryCases('{ediscoveryCaseId}')/searches('{ediscoverySearchId}')/exportResult` | ediscoverySearch: exportResult |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/caseMembers` | Add ediscoveryCaseMember |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/close` | Close eDiscoveryCase |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians` | Create custodians |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{ediscoveryCustodianId}/activate` | ediscoveryCustodian: activate |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{eDiscoveryCustodianId}/applyHold` | ediscoveryCustodian: applyHold |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{ediscoveryCustodianId}/release` | ediscoveryCustodian: release |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{eDiscoveryCustodianId}/removeHold` | ediscoveryCustodian: removeHold |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{custodianId}/siteSources` | Create custodian siteSource |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{custodianId}/unifiedGroupSources` | Create custodian unifiedGroupSource |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{ediscoveryCustodianId}/updateIndex` | ediscoveryCustodian: updateIndex |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/{custodianId}/userSources` | Create custodian userSource |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/applyHold` | ediscoveryCustodian: applyHold |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/custodians/removeHold` | ediscoveryCustodian: removeHold |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/legalHolds` | Create ediscoveryHoldPolicy |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/legalHolds/{ediscoveryHoldPolicyId}/retryPolicy` | ediscoveryHoldPolicy: retryPolicy |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/legalHolds/{ediscoveryHoldPolicyId}/siteSources` | Create siteSource |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/legalHolds/{ediscoveryHoldPolicyId}/userSources` | Create userSource |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/noncustodialDataSources` | Create nonCustodialDataSources |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/noncustodialDataSources/{ediscoverynoncustodialDatasourceId}/applyHold` | ediscoveryNoncustodialDataSource: applyHold |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/noncustodialDataSources/{ediscoveryNoncustodialDataSourceId}/release` | ediscoveryNoncustodialDataSource: release |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/noncustodialDataSources/{ediscoverynoncustodialDatasourceId}/removeHold` | ediscoveryNoncustodialDataSource: removeHold |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/noncustodialDataSources/{ediscoveryNoncustodialDataSourceId}/updateIndex` | ediscoveryNoncustodialDataSource: updateIndex |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/noncustodialDataSources/applyHold` | ediscoveryNoncustodialDataSource: applyHold |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/noncustodialDataSources/removeHold` | ediscoveryNoncustodialDataSource: removeHold |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reopen` | Reopen eDiscoveryCase |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets` | Create reviewSets |
| POST | `/security/cases/ediscoveryCases/{eDiscoveryCaseId}/reviewSets/{eDiscoveryReviewSetId}/addToReviewSet` | ediscoveryReviewSet: addToReviewSet |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets/{ediscoveryReviewSetId}/export` | ediscoveryReviewSet: export |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets/{ediscoveryReviewSetId}/queries` | Create ediscoveryReviewSetQuery |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets/{ediscoveryReviewSetId}/queries/{queryId}/applyTags` | ediscoveryReviewSetQuery: applyTags |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/reviewSets/{ediscoveryReviewSetId}/queries/{queryId}/export` | ediscoveryReviewSetQuery: export |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches` | Create searches |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/additionalSources` | Add additional sources |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/custodianSources/$ref` | Add custodian sources |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/estimateStatistics` | ediscoverySearch: estimateStatistics |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/exportReport` | ediscoverySearch: exportReport |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/exportResult` | ediscoverySearch: exportResult |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/noncustodialSources/$ref` | Add noncustodialDataSources |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/searches/{ediscoverySearchId}/purgeData` | ediscoverySearch: purgeData |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/settings/resetToDefault` | Reset ediscoveryCaseSettings to default |
| POST | `/security/cases/ediscoveryCases/{ediscoveryCaseId}/tags` | Create tags |
| POST | `/security/dataSecurityAndGovernance/processContentAsync` | tenantDataSecurityAndGovernance: processContentAsync |
| POST | `/security/dataSecurityAndGovernance/sensitivityLabels/computeRightsAndInheritance` | sensitivityLabel: computeRightsAndInheritance |
| POST | `/security/identities/identityAccounts/{identityAccountsId}/invokeAction` | identityAccounts: invokeAction |
| POST | `/security/identities/sensorCandidateActivationConfigurations` | Update sensorCandidateActivationConfiguration |
| POST | `/security/identities/sensorCandidates/activate` | sensorCandidate: activate |
| POST | `/security/identities/sensors/regenerateDeploymentAccessKey` | sensor: regenerateDeploymentAccessKey |
| POST | `/security/incidents/{incidentId}/comments` | Create comment for incident |
| POST | `/security/labels/authorities` | Create authorityTemplate |
| POST | `/security/labels/categories` | Create categoryTemplate |
| POST | `/security/labels/categories/{categoryTemplateId}/subcategories` | Create subcategoryTemplate |
| POST | `/security/labels/citations` | Create citationTemplate |
| POST | `/security/labels/departments` | Create departmentTemplate |
| POST | `/security/labels/filePlanReferences` | Create filePlanReferenceTemplate |
| POST | `/security/labels/retentionLabels` | Create retentionLabel |
| POST | `/security/runHuntingQuery` | security: runHuntingQuery |
| POST | `/security/triggers/retentionEvents` | Create retentionEvent |
| POST | `/security/triggerTypes/retentionEventTypes` | Create retentionEventType |
| POST | `/users/{userId}/dataSecurityAndGovernance/activities/contentActivities` | Create contentActivity |
| POST | `/users/{userId}/dataSecurityAndGovernance/processContent` | userDataSecurityAndGovernance: processContent |

## Recommendations

Based on coverage gaps weighted against everyday productivity workloads in a typical Microsoft 365 org, prioritize these for the next milestone:

1. **Identity & Access** — 0/809 covered (0.0%), 809 missing.
2. **Calendars** — 43/503 covered (8.5%), 460 missing.
3. **Teams & Communications** — 49/456 covered (10.7%), 407 missing.
4. **Mail (Outlook)** — 34/333 covered (10.2%), 299 missing.
5. **Users** — 41/303 covered (13.5%), 262 missing.
6. **Files / OneDrive** — 14/273 covered (5.1%), 259 missing.
7. **Groups** — 13/196 covered (6.6%), 183 missing.

### Rationale

- **HIGH-priority workloads with the largest absolute gap** dominate the list above. Closing them yields the most user-visible "fully featured" coverage for collaboration, identity, and content workflows.
- **Mail, Calendars, Files, Teams** are baseline expectations for any M365 MCP — partial coverage here is the most likely source of "the agent can't do X" complaints.
- **Identity & Access (users/groups/applications/directory)** is the second-tier priority because admin-style workflows depend on it; many gaps here are simple collection list/get ops.
- **Tasks (Planner / To Do)** and **Sites & Lists** round out productivity coverage.
- Lower-priority workloads (`tenant-management`, `device-and-app-management`, `backup-storage`, `education`, `partner-billing-reports`) are valid for specialist deployments but should not block a "general M365 MCP" milestone.
- Beta-only operations (where v1.0 Total = 0 but Beta Total > 0) should be considered separately — generally avoid surfacing beta endpoints in MCP tools unless they're load-bearing for a workload (e.g. some Copilot/Agent surfaces only exist in beta).
