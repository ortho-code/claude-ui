# A PR type's roles are changed in its file

- **Date:** 2026-11-06
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

The roles a PR type fires for are the type file's, changed by id like any field, so a reviewer who wants a PR they review to say it is ready to merge adds `"reviewing"` to `pr.approved`.

## Turned down

- A setting of their own: it would be a second place for what the file says.
