# A panel's link to a session is forgotten when the session is gone

- **Date:** 2026-09-30
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

A link to a session that is gone is forgotten at the file's next write, whatever removed the session.

## Turned down

- Forgetting by a link's age: a session started long ago may have been resumed yesterday, and a retention period counts from something the link does not know.
