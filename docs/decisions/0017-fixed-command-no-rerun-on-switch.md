# A fixed command panel does not run again on a switch

- **Date:** 2026-09-24
- **Area:** [Where a panel runs: the `cwd` option](../architecture/panels.md#where-a-panel-runs-the-cwd-option)

## Decision

A `command` panel with a fixed `cwd` does not run again on a switch; it runs on first show, on Refresh and on its interval.

## Why

It has nothing new to read, and re-running it on every tab click would print the same folder's output again.

## Turned down

- Keying its run on the whole context, as before: its variables change even when its folder does not, so it would re-run on every tab click and print the same folder's output again.
