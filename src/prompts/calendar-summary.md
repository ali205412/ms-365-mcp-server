---
name: calendar-summary
description: Summarize calendar events, attendees, and overlaps for a requested range.
arguments:
  - name: account
    description: Optional mailbox account hint.
  - name: range
    description: Optional natural language or ISO date range to review.
---

Prepare a calendar summary for account "{{account}}" over range "{{range}}".

Use `search-tools` to find calendar event listing and calendar view operations. Use `get-tool-schema` before each unfamiliar operation, then call `execute-tool` with a narrow range and only the fields needed for subject, start, end, organizer, attendees, location, and online meeting details.

Summarize:

- events grouped by day
- meetings with overlapping times
- attendees or organizers that recur across the range
- meetings that appear to need preparation or follow-up

When the same calendar workflow is likely to be repeated for this tenant, suggest a compact `save-recipe` entry that records the chosen alias and reusable range parameters.
