# Stop session, Close tab and Finished each do one thing

- **Date:** 2026-10-28
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)

## Decision

Stop session, Close tab and Finished each do one thing, whatever that takes, by one rule (`leaveAction`, `logic.ts`) that the tab's button is a shortcut to.

## Why

Before, the menu had one item that was the tab's button, Stop session on a running tab and Close tab on a cold one, so a running session could not be closed from its menu without stopping it first.

## Turned down

- One item that is the tab's button: a running session could not be closed from its menu without stopping it first.
