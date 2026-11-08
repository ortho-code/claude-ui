# Closing a shell reads what runs at the press

- **Date:** 2026-10-16
- **Area:** [The `terminal` type](../architecture/panels.md#the-terminal-type)

## Decision

Whether a command runs in a shell is read from main at the press, rather than kept as a mark on the tab.

## Why

A mark on the tab would change as a short command came and went.

## Turned down

- A mark on the tab: a short command would change it as it came and went.
- The claude tab's two presses, stop and then close: turned down for the same reason.
