# Tabs that were running no longer come back paused

- **Date:** 2026-10-28
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

A launch restores the tabs that were running cold rather than paused, and `pause` in a `settings.json` written before then is read as `cold`.

## Why

Until 2026-10-28 they came back paused, which only ever grew, since nothing on screen said which of them still wanted anything.
