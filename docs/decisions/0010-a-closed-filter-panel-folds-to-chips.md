# A closed filter panel folds down to chips of what is on

- **Date:** 2026-09-23
- **Area:** [Reopening the way you left it](../architecture/window.md#reopening-the-way-you-left-it)

## Decision

Closed over a filter that is on, the filter panel folds down to one row of chips, one per thing that is on, with the count and Clear on the line below.

## Why

The count and Clear used to sit inside the panel, and a list filtered behind a closed panel read as every session there was, with a dot on a 14px icon left to say otherwise.
A count says that something is on and not what.

## Turned down

- Moving just the count out of the panel: it was tried first and was still not enough, because a count says that something is on and not what.
