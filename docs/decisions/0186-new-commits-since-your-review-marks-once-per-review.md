# New commits since your review marks once per review

- **Date:** 2026-11-06
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

New commits since your review is kept as true or false rather than as commit ids, so it marks once per review: a second push before you review again finds it true already.

## Why

One mark per round is what it asks of you anyway.

## Turned down

- A type of its own for a rebase, which moves the head too: telling one apart would need each PR's timeline asked.
