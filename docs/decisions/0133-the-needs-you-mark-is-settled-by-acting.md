# The needs-you mark is settled by acting on the session

- **Date:** 2026-10-28
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/terminal.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

A session's needs-you mark is settled by acting on the session, not by looking at it: opening it, and claude resuming it, do not settle it.
