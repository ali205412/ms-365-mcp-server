---
name: teams-digest
description: Summarize recent Teams chats and channel activity for a team or time window.
arguments:
  - name: team
    description: Optional team, channel, or chat hint.
  - name: since
    description: Optional lower bound for recent activity.
---
Create a Teams digest for "{{team}}" since "{{since}}".

Use `search-tools` to find operations for teams, channels, chats, messages, replies, and membership. Use `get-tool-schema` to inspect the chosen operations, then use `execute-tool` with small result limits and clear time filters.

Return:
- unread or recent threads grouped by channel or chat
- decisions, asks, and blockers
- people mentioned most often
- links or files that need follow-up
- recommended next actions

If the same digest will be run repeatedly, suggest `bookmark-tool` for the selected aliases and `save-recipe` with the team and date-window parameters.
