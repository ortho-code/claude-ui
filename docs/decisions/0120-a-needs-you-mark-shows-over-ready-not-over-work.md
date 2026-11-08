# A needs-you mark shows over ready, not over work

- **Date:** 2026-10-28
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

Busy and background show over the needs-you mark, and so does waiting; the mark shows over ready, `closed` and no status.
This is the rule the dot had before the strength order was made configurable, and its default, `["waiting", "busy", "background", "needs-you", "ready", "closed"]`.

## Why

Busy and background show over the mark since claude is then working, and waiting does since claude then asks you something.
It was decided once claude's idle notice stopped writing waiting.
