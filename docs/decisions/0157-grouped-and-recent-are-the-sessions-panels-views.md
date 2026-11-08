# Grouped and Recent are the sessions panel's views

- **Date:** 2026-11-04
- **Area:** [Recent](../architecture/session-list.md#recent)

## Decision

Grouped and Recent are the sessions panel's two views, `grouped` and `recent`, kept as any panel's pick is, with the layout entry's `view` where it starts.

## Turned down

- Keeping the arrangement in `meta.json` beside the filter: it would have been a field to move once views are files, and the layout could not have started the list on Recent.
