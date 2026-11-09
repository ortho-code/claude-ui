# A close or a finish you press offers Undo

- **Date:** 2026-10-28
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)

## Decision

A close or a finish you press offers Undo in a toast (`offerUndoClose`, `offerUndoFinish`).

## Why

A stopped tab's button closes or finishes in one press, a middle-click too, and what reopening from the list loses is the tab's place, or for a finish, finding the session again in the finished view.

## Turned down

- A reopen-closed-tab key, quieter than a toast on every close: weighed and left for the keyboard shortcuts, where it is to take the same put-back.
