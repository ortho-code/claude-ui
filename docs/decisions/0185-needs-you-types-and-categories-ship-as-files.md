# Needs-you reasons have types and categories, shipped as files

- **Date:** 2026-11-06
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

Every reason a session needs you for is of a type, and every type belongs to a category, a section of the Now view to come: Your turn, Back to work, Ready to merge, Look again, Reminders and Finish up, in that order.
The app ships them as files, one JSONC object each, in `bundled/needs-you/`, written as a person's own file would be.

## Why

Each can then be changed or switched off by its id like anything else the app ships.

## Turned down

- The types and categories living in a table in the code: they could not be changed or switched off by id.
