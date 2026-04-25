---
name: inbox-triage
description: Triage unread or recent mail into action groups with draft next steps.
arguments:
  - name: account
    description: Optional mailbox account hint.
  - name: since
    description: Optional lower bound for messages to inspect.
---
Triage mail for account "{{account}}" since "{{since}}".

Use `search-tools` to find message listing, message detail, sender, and draft reply operations. Use `get-tool-schema` before calling unfamiliar operations, then use `execute-tool` to fetch unread or recent messages in small batches.

Group the messages into:
- urgent action needed
- waiting on me
- waiting on others
- FYI or archive candidate
- newsletters or bulk mail

For each group, include sender patterns, concise reasoning, and proposed next actions. If a repeated triage flow emerges, recommend `bookmark-tool` for the useful aliases and `save-recipe` for the query shape.
