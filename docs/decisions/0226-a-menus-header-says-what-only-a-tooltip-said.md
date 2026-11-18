# A menu's header says what only a tooltip said

- **Date:** 2026-11-16
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)

## Decision

A session's menu's header says a stop claude has not left, in the words of its toast, and gives its moments in full, "Last active: Tue 3 Nov, 09:00 · Opus 5.5" and "Finished: …", where its row says how long ago.
A project's and a group's menu open with a header naming the heading in full: a project's with its folder's path, a group's with its project.

## Why

A tooltip only repeats what can be read without it ([0225](0225-a-tooltip-only-repeats.md)).
The session's menu said it was stopping, but not that claude had still not left after a while, nor that it may be asking something, which the row and the tab say beside the name and a toast says in full for a tab not on show; the moment in full was on the row's hover only; a heading cut its name at the sidebar's width, a project's with its folder's path on its hover and a group's with nothing.

## Turned down

- The header saying everything the row's tooltip says, its PRs and its whole note too: the menu's actions sink far down, and the PRs would be listed twice, as 0217 found.
- Leaving the exact moments to the row's tooltip: the row's "2 h ago" is what scanning needs, so it stays short there, and the menu has room for the moment in full.
