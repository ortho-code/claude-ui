# The process group is not swept again after its leader exits

- **Date:** 2026-09-22
- **Partly replaced** by [0223](0223-a-quit-ends-everything-the-app-started.md) on 2026-11-14: at a quit, what is left in the app's sessions is ended, found by the run's id rather than by a group id.
- **Area:** [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question)

## Decision

Forcing does not sweep the group once more after the leader exits.

## Why

Nothing here has been observed needing it, and a `SIGKILL` aimed at a group id that no longer exists is the one version of this that could reach an innocent process.

## Turned down

- Sweeping the group once more *after* the leader exits, for a grandchild that changed its own group, as "their design" does in the text that recorded this: for the reason above.
