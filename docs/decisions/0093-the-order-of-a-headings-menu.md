# The order of a heading's menu

- **Date:** 2026-10-20
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)

## Decision

A heading's menu runs: the creating items first, together, New group… with them on a project; then the heading's own items; then, on a project, Jump to group; and the moves last of all (`withMoves`), each block below a rule.

## Why

The creating items are grouped by what they do.
The moves came first until the menus were seen in use, and then went to the bottom, with Jump to group just above them.

## Turned down

- Adding the creating items at the end: it would have split the ways to add something over two blocks.
- The moves first.
