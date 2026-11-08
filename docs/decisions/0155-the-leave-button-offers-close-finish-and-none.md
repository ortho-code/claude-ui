# The leave button offers close, finish and none as choices

- **Date:** 2026-11-03
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/terminal.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

The `leaveButton` setting offers `close` and `finish`, which end a running tab in one press, and `none`, which takes the button away, as a choice made in Settings rather than the default.

## Why

The two steps of the default choices are why the button cannot lose a session by accident.
