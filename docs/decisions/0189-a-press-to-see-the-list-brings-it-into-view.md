# A press that asks to see the list brings it into view

- **Date:** 2026-11-08
- **Area:** [A session's menu holds everything about it](../architecture/terminal.md#a-sessions-menu-holds-everything-about-it)

## Decision

A press that asks to see the list brings it into view; following a session only keeps the list in step, unfolding inside it and never touching the layout.

## Why

A folded sidebar stays folded while you switch tabs.

## Turned down

- Every jump into the list bringing it into view: it unfolded the sidebar, or left a full-screen terminal area, on every tab switch.
- Any click on the tab on show counting as a press to see the list: it would unfold the sidebar on every click back into the terminal.
