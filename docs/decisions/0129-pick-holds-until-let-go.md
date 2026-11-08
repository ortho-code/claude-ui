# A picked checkout holds until it is let go

- **Date:** 2026-10-28
- **Area:** [Where a panel runs: the `cwd` option](../architecture/panels.md#where-a-panel-runs-the-cwd-option)

## Decision

A picked checkout holds the panels there whatever the session goes on to change, until "Follow the session" lets go.

## Why

The panels would otherwise move while you read them.

## Turned down

- Letting go at the session's next change elsewhere: the panels would move while you read them.
