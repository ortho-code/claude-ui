# A panel's row that names a session shows its note mark

- **Date:** 2026-11-11
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

A list panel's row that names a session (`session`) shows that session's note mark beside its dot while the session has a note, the same mark as on its row in the session list: the note on hover, a press opening it to edit.
The app draws it for every type from the config folder, and the list contract has no field to switch it off.
The note mark comes alone: the session row's other marks, such as set aside, its PRs or its worktree, stay off a panel's row.

## Why

A note is often why a session waits, such as the reason it was set aside, and a panel that lists sessions to come back to is where that is wanted.
One mark drawn by the app reads and acts the same on every surface, where each type drawing the note its own way would not.
The other marks say what a type's own lines already say, such as a set-aside moment or a PR's state, so they would repeat it.
No type wants the mark off yet, and a field to switch it off can be added later without breaking a type that leaves it out.

## Turned down

- The note's text in the sessions file, for a type to show as a line of its own: each type would draw it differently, and the whole note would sit in every row.
- A field on the item to switch the mark off, now: nothing asks for it, so it waits for a type that does.
