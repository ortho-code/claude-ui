# Every way the app opens a session refuses a finished one

- **Date:** 2026-11-05
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)

## Decision

Every way the app opens a session refuses a finished one (`unopenableReason`, `state/views.ts`).

## Turned down

- Opening it to make it unfinished: not clear enough about what had happened.
