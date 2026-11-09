# The launcher refuses a session whose folder is gone

- **Date:** 2026-09-22
- **Area:** [A session whose folder is gone](../architecture/claude.md#a-session-whose-folder-is-gone)

## Decision

The launcher refuses the spawn outright when the session's directory is missing.

## Turned down

- Substituting `$HOME` instead, silently, as it used to: the session ran somewhere nobody chose, and then wrote its transcript under the home directory's project, so it moved in the sidebar too — the only sign being Claude Code asking for workspace trust on `~`.
