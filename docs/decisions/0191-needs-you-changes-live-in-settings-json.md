# Changes to the shipped needs-you types live in settings.json

- **Date:** 2026-11-08
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

The changes to the needs-you categories and types moved from a file per id under `needs-you/` into `needsYou` in `settings.json`, before any release had the files.
What you add of your own, such as a type, is to go in a folder of its own.

## Why

What changes what the app ships then sits in the one file the app may write, beside the looks and the strength order of the same categories and types.
Settings can one day reset an entry, which it could never do to a file of yours.

## Turned down

- A file per id under `needs-you/`, as it was until then: Settings could never reset a file of yours.
