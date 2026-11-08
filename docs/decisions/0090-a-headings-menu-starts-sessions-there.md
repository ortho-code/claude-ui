# A heading's menu holds the ways to start a session there

- **Date:** 2026-10-20
- **Area:** [A session's menu holds everything about it](../architecture/terminal.md#a-sessions-menu-holds-everything-about-it)

## Decision

A heading's menu holds New session and New worktree session…, from one function (`newSessionItems`, `sessions/controls.ts`) that the "+"'s caret draws too.

## Why

So the dropdown and the two menus cannot drift.
