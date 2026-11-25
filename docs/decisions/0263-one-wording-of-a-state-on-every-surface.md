# One wording of a state on every surface

- **Date:** 2026-11-25
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

A state is worded once, and every surface that names it uses those words: a reason as "PR #7 · Title — checks failed", "Reminder for Mon 3 Nov, 09:00" or "Was running when the app quit", and claude's statuses `busy` as "Working" and `ready` as "At its prompt".
A list of every state a session is in, the dot's tooltip and the menu's header, has no heading saying the session needs you, so it leads each reason with "Needs you — "; a surface whose heading says it shows the words bare.

## Why

A list of sessions that need you, laid out in sections, states every reason on a line of its own under a heading that already says why the session is there, and a second wording of the same reason for that list would drift from the tooltip's.
Under a section of sessions whose claude runs, "Busy" reads as a complaint, where "Working" says what claude is doing, as "Working in the background" already did; "Ready" said little about what it is ready for.

## Turned down

- Words of its own for the list of sessions that need you: two wordings of one state, which drift.
- The tooltip's words with their prefix everywhere: the prefix repeats what a section's heading says, on every line under it.
