# The clock has its place in a session's menu

- **Date:** 2026-10-27
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)

## Decision

The clock, which opens nothing, has its place in the menu too: Scheduled, a submenu of its tasks in the clock's own words, as lines to read rather than items to press (`clockLines`).

## Why

A submenu of items that do nothing would look as if they did.

## Turned down

- Its words in the menu's header, where the worktree mark's and the note's first line are, weighed and left: the siblings and PR marks, and the worktree mark while it lists checkouts, each have a submenu, and among those the clock would be found under none.
- Its tasks as items to press: a submenu of items that do nothing would look as if they did.
