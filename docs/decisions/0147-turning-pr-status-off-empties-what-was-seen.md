# Turning PR status off empties what was seen

- **Date:** 2026-10-29
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

Turning the `prStatus` setting off empties what was seen, read or not, and so does a launch with it off.

## Why

Turning it on then starts from the PRs as they are and marks only what changes after, the first run included for a setting that was off from the start.

## Turned down

- Comparing with what was seen before it went off: harder to predict.
