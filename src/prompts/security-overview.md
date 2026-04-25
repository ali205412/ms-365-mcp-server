---
name: security-overview
description: Summarize tenant security posture from risk, sign-in, role, and audit signals.
arguments: []
---

Prepare a high-level tenant security overview.

Use `search-tools` to find operations for risky users, sign-ins, directory roles, applications, service principals, audit events, and conditional access when available. Use `get-tool-schema` for each selected operation, then call `execute-tool` with narrow limits and time windows.

Summarize:

- identity risk or sign-in anomalies
- privileged role assignments
- application and service principal findings
- recent audit events worth review
- missing permissions or data sources

Do not expose secrets or token material. If the tenant repeats this review, recommend `bookmark-tool` for the selected aliases and `save-recipe` for the review sequence.
