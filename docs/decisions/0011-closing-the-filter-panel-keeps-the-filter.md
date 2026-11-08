# Closing the filter panel keeps the filter, and its toggle is a funnel

- **Date:** 2026-09-23
- **Area:** [Reopening the way you left it](../architecture/window.md#reopening-the-way-you-left-it)

## Decision

Closing the filter panel keeps the filter that is on.
The toggle is a funnel rather than a magnifier.

## Why

A magnifier promises a search box, which clears when it closes.

## Turned down

- Clearing the filter on close, the fix first asked for: closing the panel would disagree with quitting the app, which restores the filter on purpose.
