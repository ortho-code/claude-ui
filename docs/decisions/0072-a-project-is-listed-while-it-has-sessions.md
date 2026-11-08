# A project is listed while it has sessions

- **Date:** 2026-10-15
- **Area:** [App-side metadata and session groups](../architecture/sessions.md#app-side-metadata-and-session-groups)

## Decision

A project is listed while it has a session that is not being deleted, finished ones included, and deleting its sessions is what takes it away.

## Turned down

- Keeping every project the app has ever known, with sessions on disk or not, left for later: it needs a look at whether each folder is still there, and a way to remove a project, or the list would only ever grow.
