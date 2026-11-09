# A cleared session is a session with nothing in it

- **Date:** 2026-09-22
- **Area:** [A cleared session is a new session](../architecture/claude.md#a-cleared-session-is-a-new-session)

## Decision

The app treats what comes out of `/clear` as a session with nothing in it: the folder is all that carries over.

## Why

`/clear` is "start again here".

## Turned down

- Carrying the previous summary forward, which is what the code did at first: it gave the new session a title, a first message and sibling marks belonging to a conversation it does not have.
