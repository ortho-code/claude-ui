# How each state is drawn is its look, kept in settings.json

- **Date:** 2026-11-06
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

How each state is drawn is its look (`looks` in `settings.json`), for a status, `needs-you`, a category or a type, by its id.
The looks are kept in `settings.json`.

## Why

How a state looks sits with the strength order, both in the one file the app may write when Settings gets fields for them, while the needs-you files keep saying only whether and where a reason marks.

## Turned down

- The looks in each category's and type's file, or in a folder of their own: how a state looks would not sit with the order in the one file the app may write.
