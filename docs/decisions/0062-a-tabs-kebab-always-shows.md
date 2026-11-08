# A tab's kebab always shows

- **Date:** 2026-10-08
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/terminal.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

The kebab beside a tab's button shows on every tab, not only on hover or on the tab on show.

## Why

A tab must not change width under the pointer.

## Turned down

- Showing the kebab only on hover or on the tab on show: the tab would change width under the pointer.
