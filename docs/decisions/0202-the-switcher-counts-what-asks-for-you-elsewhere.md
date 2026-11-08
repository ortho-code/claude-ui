# The switcher counts what asks for you elsewhere

- **Date:** 2026-11-08
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

The switcher's title shows how many sessions in projects other than the one on show ask for you, drawn in the colour of the strongest of what it counts, in the count pill the headings wear.
In All it counts every project.

## Why

A session counts when its part in a roll-up asks for you, so the count always agrees with the dots you find when you go there.
All has no elsewhere and is where a summary of everything is wanted.

## Turned down

- Counting every project always, as the roll-up dot it replaced did: the project on show is already on screen in its tabs and rows, so it could not say "elsewhere".
- A pill always in the needs-you colour: it loses waiting against a merged PR.
