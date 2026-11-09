# The app chooses the session id

- **Date:** 2026-09-22
- **Area:** [The app chooses the session id](../architecture/claude.md#the-app-chooses-the-session-id)

## Decision

Every session the app starts is created under an id the app mints, handed to `claude` as `--session-id`.

## Why

The transcript then lands under exactly that id, so a tab knows which session it is running before the process has even spawned.

## Turned down

- Letting `claude` pick and finding out afterwards, which is what the app used to do: the cost was spread across the whole renderer: a tab held a made-up `new-<timestamp>` id, group membership for such a session was held in a second in-memory map until the real id arrived, and a row created inside a group could still appear loose and jump into place a moment later.
