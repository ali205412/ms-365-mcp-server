# Users Workload Guide

Use this guide for user lookup, profile reads, manager and direct-report checks, license or directory context, and user-related activity workflows.

## Discovery Loop

Start with `search-tools` queries such as "find user by email", "get user profile", "list direct reports", or "read manager". Include user, profile, manager, or directory terms when searching.

Then use `get-tool-schema` to check whether the alias expects a user id, user principal name, filter, or paging input. Use `execute-tool` once identity fields are unambiguous.

## Useful Resource Path

Read `mcp://catalog/scope-map.json` to understand when directory reads, user profile reads, or higher-privilege directory operations diverge. Use endpoint schema resources for parameter details.

## Memory

Bookmark lookup aliases that reliably resolve people. Save recipes for onboarding checks, org-chart summaries, and repeat user activity reports.
