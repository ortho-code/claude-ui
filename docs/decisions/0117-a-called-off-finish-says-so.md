# A prompt that calls a finish off says so

- **Date:** 2026-10-28
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)

## Decision

A prompt that calls a finish off says so in a toast, naming the session.

## Why

A prompt sent just before the press can report after it, and claude then leaves on the presses with the session unfinished: the status the window is given does not say when the prompt was sent, the hook's file having it only to the second, so the app cannot tell it from one sent after.

## Turned down

- Keeping that tab, cold, at an exit soon after a call-off: telling such an exit from claude ending by itself later would take a time window nothing measures.
