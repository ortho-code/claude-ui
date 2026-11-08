# A dragged size is kept per node

- **Date:** 2026-10-07
- **Area:** [Sizes](../architecture/panels.md#sizes)

## Decision

A size dragged to is kept per node in its own unit, over the file's.

## Why

Kept whole, a size written into the app's file by hand did nothing unless every sibling had one.

## Turned down

- The first layout plan's rule, that a split's dragged sizes were kept or dropped whole: a size written into the app's file by hand did nothing unless every sibling had one.
