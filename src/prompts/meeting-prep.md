---
name: meeting-prep
description: Prepare for a meeting by gathering event, attendee, mail, and organization context.
arguments:
  - name: eventId
    description: Optional calendar event identifier.
  - name: attendeeFocus
    description: Optional person, group, or domain to prioritize.
---

Prepare meeting context for event "{{eventId}}" with attendee focus "{{attendeeFocus}}".

Use `search-tools` to find event detail, attendee, message search, people, and organization operations. Use `get-tool-schema` for the selected operations and call `execute-tool` in the smallest useful sequence: event details first, attendees second, then recent messages or profile context for the focused attendees.

Produce:

- meeting goal inferred from title, agenda, and recent thread context
- attendee list with likely roles
- recent relevant emails or chats to review
- unresolved questions to raise
- suggested preparation checklist

If the workflow produces a stable pattern, suggest `save-recipe` with the chosen event and attendee lookup aliases.
