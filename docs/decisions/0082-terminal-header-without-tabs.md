# A terminal panel with no tab has the ordinary header

- **Date:** 2026-10-16
- **Area:** [The `terminal` type](../architecture/panels.md#the-terminal-type)

## Decision

With no tab, a terminal panel's header is the ordinary one and the line in the panel's body is the way in; the `+` comes with the first tab.

## Why

A header holding only a `+` read as something gone wrong.

## Turned down

- A header holding only a `+`: it read as something gone wrong.
- The title with a `+` button at its right end: it put two "new terminal" buttons on screen at once.
- The title with a `+` after it, a heading with an add button: nothing else in the app has one.
