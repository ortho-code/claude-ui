# The menu's header lists each state a session is in

- **Date:** 2026-10-28
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)
- **Partly replaced** by [0174](0174-a-dots-tooltip-lists-every-state-the-session-is-in.md) on 2026-11-06: the header's lines run in the strength order, the dot's first, not the status and then the needs-you mark.

## Decision

The menu's header gives each state the session is in a line of its own with its dot: its status as its hooks last reported it and its needs-you mark, in that order (`statusLines`).

## Why

Its one dot shows only the strongest (`dotStatus`), so a session ready and needing you says both here.

## Turned down

- The status ending the project's line, one state only, as it used to.
