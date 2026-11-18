# A failed run's lines unfold under its line

- **Date:** 2026-11-16
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

The line a list keeps above a good list when a run fails unfolds, on a press, what the script wrote last on stderr, or the list's mistakes, under it; it starts folded, and a failure that wrote nothing has nothing to unfold.

## Why

Failures show where they failed, and why ([principles](../principles.md#failures-show)); what the script wrote was on the line's hover alone ([0225](0225-a-tooltip-only-repeats.md)).
Folded at first, the list keeps its place under a run that keeps failing.

## Turned down

- The lines always shown under it: every failed tick would push the list down until a run succeeds.
- The fold chevron the dividers and the tab bar use: it is a tab laid on a line, not a press on a line of text.
