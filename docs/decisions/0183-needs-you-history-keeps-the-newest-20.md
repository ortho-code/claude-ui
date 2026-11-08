# The needs-you history keeps the newest 20 per session

- **Date:** 2026-11-06
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/terminal.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

The needs-you history keeps the newest 20 entries per session (`HISTORY_KEPT`).

## Why

At the rate measured here, that is weeks to months of one session's reasons, and bounded, so a history never only grows.

## Turned down

- A cap by age: a session picked up months later would find it empty.
