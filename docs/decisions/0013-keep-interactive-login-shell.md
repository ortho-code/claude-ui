# A command runs in an interactive login shell

- **Date:** 2026-09-23
- **Area:** [How a command runs](../architecture/panels.md#how-a-command-runs)

## Decision

A panel's command runs in the same interactive login shell as a session, and the job-control noise that prints is handled by shape rather than by filtering text.

## Why

A panel sees the `PATH` a session sees, with the rc-based setup run.

## Turned down

- Dropping `-i`: mise resolves without it on the machine this was written on, but the rc-based setup would be skipped and a panel would no longer see the `PATH` a session sees.
