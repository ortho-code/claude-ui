# What the app ships is overridden by id, field by field

- **Date:** 2026-11-04
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

A change to something the app ships names it by its id: a field an entry names replaces the shipped one's, and every other stays the shipped one's.
It is the one rule every kind the app ships this way is to take: the needs-you categories and types (built 2026-11-06), views and a plugin's parts later.

## Why

A later version's change to a field left alone still arrives.

## Turned down

- Copying the bundled files into the config folder at first launch: a later version's change to a field left alone would have been lost.
