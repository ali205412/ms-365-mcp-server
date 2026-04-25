# Files Workload Guide

Use this guide for OneDrive and drive item discovery, file search, upload or download preparation, sharing links, folder navigation, and item metadata updates.

## Discovery Loop

Start with `search-tools` queries such as "search drive files", "list children in folder", "create sharing link", or "upload file". Mention OneDrive, drive, folder, or file when the scope matters.

Then use `get-tool-schema` to check drive ids, item ids, paths, conflict behavior, and upload parameters. Use `execute-tool` after confirming whether the action reads metadata, fetches content, or mutates a drive item.

## Useful Resource Path

Read `mcp://catalog/scope-map.json` to distinguish read-only file operations from write or sharing operations. The concrete endpoint schema is generated at read time for the chosen alias.

## Memory

Bookmark file search and folder navigation aliases. Save recipes for repeated site or drive searches, standard sharing-link settings, and upload patterns.
