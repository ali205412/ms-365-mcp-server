# Presence Workload Guide

Use this guide for presence checks, availability-aware workflows, and lightweight collaboration routing.

## Discovery Loop

Start with `search-tools` queries such as "get user presence", "list presence for users", or "check availability". Include presence or availability to avoid broad user-directory results.

Then use `get-tool-schema` to inspect user id lists, batching limits, and read requirements. Use `execute-tool` after confirming the query is read-only and the target users are known.

## Useful Resource Path

Read `mcp://catalog/scope-map.json` when presence operations fail because the tenant lacks the required presence consent. Endpoint schema resources provide parameter details when read by alias.

## Memory

Bookmark presence lookup aliases for support and routing workflows. Save recipes for repeated team availability checks that change only the user list.
