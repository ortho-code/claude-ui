# The log has no size cap

- **Date:** 2026-09-28
- **Area:** [The log](../architecture/logs.md#the-log)

## Decision

A log file has no size cap.

## Why

The date roll keeps a file readable and loses nothing within a run.

## Turned down

- Cutting the middle out at 2 MB.
- Rolling to part files.
- Trimming the oldest lines as the audit log does: it loses the header, the lines that say what build this was.
- Stopping at the cap: it loses the end, where a crash is.
- A hard ceiling as a backstop.
