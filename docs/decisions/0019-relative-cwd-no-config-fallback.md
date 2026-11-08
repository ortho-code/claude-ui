# A relative cwd never falls back to the config folder

- **Date:** 2026-09-24
- **Area:** [Where a panel runs: the `cwd` option](../architecture/panels.md#where-a-panel-runs-the-cwd-option)

## Decision

A relative `cwd` resolves against the project and never falls back to the config folder.

## Why

With a fallback, the same file would run in different places depending on which folders happen to exist, and a typo in one project would silently become a folder in the config directory.

## Turned down

- Falling back to the config folder: the same file would then run in different places depending on which folders happen to exist, and a typo in one project would silently become a folder in the config directory.
