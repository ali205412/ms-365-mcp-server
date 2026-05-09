---
name: recipe-author
description: Guide the model through discovering, validating, and saving a reusable tool recipe.
arguments: []
---

Author a reusable tenant recipe from the user's workflow goal.

First restate the goal as an input/output contract. Use `search-tools` to discover candidate operations, `get-tool-schema` to inspect parameters, and `execute-tool` for a minimal validation run with safe, narrow inputs.

When the workflow is proven:

- choose one primary alias
- record stable parameters and which parameters should be overridden at run time
- write a short note explaining when to use it
- call `save-recipe` with the chosen name, alias, parameters, and note

If the alias is broadly useful outside this recipe, also call `bookmark-tool`. Keep the saved recipe focused on one repeatable action rather than a long multi-step script.
