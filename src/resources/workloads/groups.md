# Groups Workload Guide

Use this guide for Microsoft 365 group lookup, group membership, owners, lifecycle checks, and group-backed collaboration workflows.

## Discovery Loop

Start with `search-tools` queries such as "list groups", "get group members", "add group owner", or "read group details". Include member, owner, or group lifecycle words when relevant.

Then use `get-tool-schema` to inspect group ids, member ids, owner ids, filters, and paging inputs. Use `execute-tool` only after the membership or ownership target is clear.

## Useful Resource Path

Read `mcp://catalog/scope-map.json` to separate read, membership, and ownership permissions before choosing an alias. Endpoint schemas are generated separately for selected aliases.

## Memory

Bookmark the aliases that support common membership reviews. Save recipes for periodic group audits, owner checks, and repeat membership changes.
