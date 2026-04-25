# Mail Workload Guide

Use this guide for inbox triage, message search, sending mail, draft review, folder cleanup, and attachment-oriented mail workflows.

## Discovery Loop

Start with `search-tools` queries such as "find unread messages", "send a reply", "move message to folder", or "list mail folders". Prefer goal language over alias guessing.

Then use `get-tool-schema` on the candidate alias to check required message ids, account fields, body formats, and paging controls. Finish with `execute-tool` only after the schema matches the mail action.

## Useful Resource Path

Read `mcp://catalog/scope-map.json` when mail results are absent or permission errors mention consent. The map explains which scopes the candidate alias needs without embedding endpoint schemas in this guide.

## Memory

Bookmark aliases for daily inbox operations. Save recipes for recurring searches, triage views, and draft-send flows where only the account, folder, or query changes.
