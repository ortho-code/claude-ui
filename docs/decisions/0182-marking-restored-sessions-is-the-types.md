# Marking restored sessions is the needs-you type's, not the launch setting's

- **Date:** 2026-11-06
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/terminal.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

Whether a launch marks the sessions that were running as needing you is decided by the type `app.was-running`, not by `runningSessionsAtLaunch`, and the setting's old values `mark`, `pause` and `leave` are read as `cold`.

## Why

Marking became the type's, one place for that answer.
Until 2026-11-06 the setting said whether they were marked too, `mark`, `start` or `leave`, the last restoring them unmarked.
