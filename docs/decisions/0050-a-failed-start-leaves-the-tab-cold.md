# A failed start leaves its tab cold

- **Date:** 2026-10-07
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

A tab whose start failed is cold like any other, since its process has gone.

## Why

It used to keep the dead process's id, which main no longer knew, so its stop was ignored and its button never closed it.
