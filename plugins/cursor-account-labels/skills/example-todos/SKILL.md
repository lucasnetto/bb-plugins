---
name: example-todos
description: Read and update the Cursor Account Labels plugin's example todo list with the `bb cursor-account-labels` CLI. Use when the user asks to add, complete, reopen, remove, or review todos, or when the steps of a task should be tracked as todos.
---

# Example todos

The Cursor Account Labels plugin keeps one todo list. The Example todos page in the BB sidebar and
the `bb cursor-account-labels` command read and write the same list, so a change from either
side shows in the other at once.

## Commands

| Command                                     | Effect                                                |
| ------------------------------------------- | ----------------------------------------------------- |
| `bb cursor-account-labels list`             | Show every todo with its id. `[x]` marks a done todo. |
| `bb cursor-account-labels add <title>`      | Add a todo. Quote a title that has spaces.            |
| `bb cursor-account-labels done <todo-id>`   | Mark a todo done.                                     |
| `bb cursor-account-labels undo <todo-id>`   | Mark a todo not done.                                 |
| `bb cursor-account-labels remove <todo-id>` | Delete a todo.                                        |

Add `--json` to any command when the output drives code.

## Procedure

1. Run `bb cursor-account-labels list` before you change the list. Use the ids it prints;
   never guess an id.
2. Add todos one at a time with a short title that starts with a verb:
   `bb cursor-account-labels add "Write the release notes"`.
3. When you finish a todo, mark it done: `bb cursor-account-labels done <todo-id>`. Do not
   remove a todo to mark it done.
4. Remove a todo only when the user asks for it or when it duplicates
   another todo.
5. End with a short summary of what you added, completed, or removed.

## Rules

- Change the list only through `bb cursor-account-labels`. Do not edit bb.db or the plugin's
  storage directly.
- A non-zero exit with "No todo with id" means the id is stale: run
  `bb cursor-account-labels list` again.
