# Finished sessions are kept under `finished`

- **Date:** 2026-11-05
- **Area:** [App-side metadata and session groups](../architecture/sessions.md#app-side-metadata-and-session-groups)

## Decision

The finished sessions are kept in `meta.json` under `finished`.
A file an older build wrote holds them as `archived`, which is read into `finished` and dropped at the next write, and `ui.filters.archived` the same way into `ui.filters.finished`.

## Why

Archive was renamed Finished, and the field follows the name.
