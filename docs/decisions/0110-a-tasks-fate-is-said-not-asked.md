# What becomes of a scheduled task is said, not asked at a stop

- **Date:** 2026-10-24
- **Area:** [Stopping a session is a request: claude may answer it with a question](../architecture/terminal.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question)

## Decision

The clock's tooltip says of each task whether it comes back or ends with the session, before a stop, and nothing asks it at one.

## Why

For a cron claude asks its own question straight after the presses, and two questions about one task are too many.

## Turned down

- A confirm dialog before the presses, tried in the app: for a cron claude asks its own question straight after the presses, and two questions about one task are too many.
