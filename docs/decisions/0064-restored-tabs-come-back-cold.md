# Tabs that were running come back cold at launch

- **Date:** 2026-10-08
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

By default (`cold`) a launch restores the tabs whose sessions were running when the app closed cold, so they cost no process.

## Turned down

- Starting every restored tab: it used to mean 20 processes at ~437 MB each for 20 tabs, whether or not any was in use.
