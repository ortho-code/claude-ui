# The grace before SIGKILL is 3 s

- **Date:** 2026-10-07
- **Area:** [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question)

## Decision

A forced session gets `SIGKILL` after a 3 s grace from its `SIGTERM`.

## Why

A worktree session left on `SIGTERM` in 0.75 to 1.52 s across five runs, and ran its SessionEnd hook on the way in the one run that logged hooks.

## Turned down

- The 1.2 s grace there was before: it cut the slow end short.
