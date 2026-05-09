---
name: file-search-deep
description: Search across SharePoint and OneDrive, rank candidate files, and explain why each matters.
arguments:
  - name: query
    description: Search query or topic to investigate.
    required: true
  - name: site
    description: Optional SharePoint site, drive, or workspace hint.
---

Run a deep file search for "{{query}}" with optional site hint "{{site}}".

Use `search-tools` to identify Microsoft Graph file, drive, SharePoint site, and search operations. Use `get-tool-schema` for the strongest candidate operations before calling `execute-tool`. Start broad, then narrow by site, drive, path, modified date, author, and file type as the results suggest.

For each promising file, return:

- title or file name
- location context
- why it matches the query
- last modified signal
- next action, such as opening metadata, downloading content through an approved tool, or saving the operation

If a particular file-search operation works well for this tenant, use `bookmark-tool` to preserve the alias and propose a `save-recipe` entry for repeated searches.
