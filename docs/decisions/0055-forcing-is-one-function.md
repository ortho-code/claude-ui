# Forcing a session is one function, for every route

- **Date:** 2026-10-07
- **Area:** [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question)

## Decision

Forcing is one function, for every route: it signals the process group and escalates from `SIGTERM` to `SIGKILL`.

## Turned down

- The stop, the close and the quit as three functions, each sending a single signal and then forgetting the process, as they used to: a bare `kill()`, which is `SIGHUP` and which a Node program is entitled to decline, and the stop then reported success over a session that was still running.
