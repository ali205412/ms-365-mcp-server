---
name: permissions-audit
description: Review granted scopes and explain what Microsoft 365 capabilities they unlock.
arguments: []
---
Audit the tenant's granted permissions and explain operational impact.

Use `search-tools` to identify scope, permission, directory role, and application operations. Use `get-tool-schema` before live calls, then use `execute-tool` to inspect granted scopes or permission-related resources available to the tenant.

Report:
- granted scopes grouped by workload
- what each scope enables in plain language
- high-risk permissions that deserve review
- missing scopes that may block common workflows
- recommended follow-up checks

When recurring permission checks are useful, propose `bookmark-tool` for the best aliases and a `save-recipe` entry for a repeatable audit workflow.
