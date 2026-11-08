# A picked checkout is the session's, not its tab's

- **Date:** 2026-10-27
- **Area:** [Where a panel runs: the `cwd` option](../architecture/panels.md#where-a-panel-runs-the-cwd-option)

## Decision

A checkout picked from the session's worktree list is the session's, not its tab's, and is kept in memory only.

## Why

The list is then the same and does the same on every surface it is on, a tab or none, which is what lets a surface be left out of a layout one day.

## Turned down

- Picking from a panel's own header: it reads as that panel's alone, while every panel without a folder of its own moves.
- A pick that only the tab's menu makes, the row's list being read-only: the session's menu is to be the same on every surface.
