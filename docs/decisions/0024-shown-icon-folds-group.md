# The shown panel's rail icon folds its group

- **Date:** 2026-09-28
- **Area:** [Several panels in a group](../architecture/panels.md#several-panels-in-a-group)

## Decision

Clicking the shown panel's own icon folds the group, as VS Code's activity bar does, through the same fold as the chevron (`toggleFold`).

## Why

A panel is put away from the icon that brought it out.
Both controls calling the one fold means they cannot fold a group two ways.

## Turned down

- The icon doing nothing, as it used to, which kept the chevron the one fold control.
