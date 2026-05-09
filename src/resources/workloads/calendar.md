# Calendar Workload Guide

Use this guide for event lookup, schedule review, free/busy discovery, attendee checks, reminders, and calendar item maintenance.

## Discovery Loop

Start with `search-tools` queries such as "list events this week", "find meeting times", "create calendar event", or "update event attendees". Keep the query close to the user task.

Then use `get-tool-schema` to inspect date range, attendee, timezone, account, and paging parameters. Use `execute-tool` after the required time window and identity inputs are clear.

## Useful Resource Path

Read `mcp://catalog/scope-map.json` to compare calendar read and write consent before selecting an alias. Endpoint schemas are generated separately at `mcp://endpoint/{alias}.schema.json`.

## Memory

Bookmark the aliases that work for schedule summaries and attendee updates. Save recipes for weekly agenda summaries, conflict checks, and recurring event creation patterns.
