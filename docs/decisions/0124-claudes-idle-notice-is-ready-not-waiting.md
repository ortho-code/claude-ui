# Claude's idle notice is ready, not waiting

- **Date:** 2026-10-28
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

Claude's idle notice (`Notification` with `notification_type: "idle_prompt"`) does not write waiting.

## Why

It says the turn is done, which the `Stop` before it already said, and asks nothing, so it is not waiting.
It used to turn every ready session's dot to waiting a minute after its turn, which made waiting say nothing that ready did not.
