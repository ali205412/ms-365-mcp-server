---
name: recent-activity
description: Build a cross-workload recent activity feed for a user.
arguments:
  - name: userId
    description: Optional user identifier or user principal name.
---
Build a recent activity view for user "{{userId}}".

Use `search-tools` to find relevant operations for mail, calendar, files, chats, teams, and directory profile context. Use `get-tool-schema` to inspect candidate operations, then call `execute-tool` in bounded batches with clear time windows and small result limits.

Create a timeline grouped by workload:
- mail and conversations
- meetings and calendar changes
- files touched or shared
- teams and chat activity
- profile or presence signals when available

Call out gaps where the tenant lacks permission. If the user wants this often, recommend `bookmark-tool` for the aliases and `save-recipe` for the activity-feed parameters.
