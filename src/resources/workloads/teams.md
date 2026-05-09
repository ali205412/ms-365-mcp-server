# Teams Workload Guide

Use this guide for Teams, channels, chat messages, channel messages, membership checks, and collaboration activity review.

## Discovery Loop

Start with `search-tools` queries such as "list teams", "read channel messages", "send chat message", or "find channel members". Include "team", "channel", or "chat" to keep results focused.

Then use `get-tool-schema` to identify the ids required by the selected alias, such as team, channel, chat, or message identifiers. Use `execute-tool` once those ids and body parameters are known.

## Useful Resource Path

Read `mcp://catalog/scope-map.json` when Teams and chat aliases look similar but require different Graph scopes. Use generated endpoint schema resources for parameter details.

## Memory

Bookmark common read aliases for digest workflows. Save recipes for recurring team reports, channel activity checks, and message-posting patterns that reuse the same target channel.
