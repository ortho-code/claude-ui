# A context change runs a hidden panel too

- **Date:** 2026-10-30
- **Area:** [A layout change keeps panels running](../architecture/panels.md#a-layout-change-keeps-panels-running)

## Decision

A context change runs a hidden panel that has run before, as it runs a shown one.

## Why

A count from another folder says something false, as one that stops does.

## Turned down

- Never running a hidden panel on a context change, only noting the difference for its next reveal, as until 2026-10-30: a folded panel's count on its rail stayed the folder's before the switch until it was opened or its interval next ran it.
