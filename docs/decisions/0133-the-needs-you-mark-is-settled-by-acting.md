# The needs-you mark is settled by acting on the session

- **Date:** 2026-10-28
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process)
- **Partly replaced** by [0222](0222-a-pr-reason-github-takes-back-is-settled.md) on 2026-11-14: a reason for a PR's failing checks, conflict or requested changes is also settled once GitHub no longer says it.

## Decision

A session's needs-you mark is settled by acting on the session, not by looking at it: opening it, and claude resuming it, do not settle it.
