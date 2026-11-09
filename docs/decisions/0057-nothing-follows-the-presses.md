# Nothing follows the presses of a stop

- **Date:** 2026-10-07
- **Area:** [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question)

## Decision

Nothing follows the Ctrl-C presses of a stop: the tab stays, stopping, with its terminal kept and answerable, until the pty exits.
A close keeps the tab the same way and removes it when the exit lands.

## Why

Claude can answer an exit with a question and waits for the answer, and nothing it sends tells asking from being slow.

## Turned down

- Sending `SIGTERM` 1.8 s after the first press, as an earlier version did: it killed the question and left the tree kept but locked, and it also ended every stop of a session mid-turn, which two presses alone did not end in either run probed.
- Removing a closed tab first: a tab removed first is what made the question unreachable.
