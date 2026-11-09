# A session keeps every reason it needs you for

- **Date:** 2026-10-29
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

A session keeps every needs-you reason rather than the newest alone: a new reason is added beside the others and replaces the reason of its own kind.
A file from before then holds one reason per session, read as a list of one.

## Why

A session picked up again still says every reason it needed you for.

## Turned down

- The newest reason replacing the others: it lost why it needed you before.
- The highest-ranked one winning: it lost a lower one coming in.
