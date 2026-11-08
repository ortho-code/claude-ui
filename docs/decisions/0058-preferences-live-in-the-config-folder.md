# The app's preferences live in the config folder

- **Date:** 2026-10-07
- **Area:** [App-side metadata and session groups](../architecture/sessions.md#app-side-metadata-and-session-groups)

## Decision

The app's own preferences are not in `meta.json`: they live in the config folder.

## Why

They are what you chose rather than where you left off, neither should be able to reset the other, and they are yours to edit and share.
They were kept in `meta.json` as `settings` until 2026-10-07.
