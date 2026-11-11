# A project whose folder is gone is marked, not hidden

- **Date:** 2026-09-28
- **Area:** [A session whose folder is gone](../architecture/claude.md#a-session-whose-folder-is-gone)
- **Partly replaced** by [0072](0072-a-project-is-listed-while-it-has-sessions.md) on 2026-10-15: finishing a dead project's sessions no longer takes it out of the switcher, only deleting them does; the mark rather than hiding still holds.

## Decision

A project whose folder is gone is marked wherever it is named, rather than hidden.

## Why

An unmounted drive would make a project you use every day vanish without a word, and a dead project nobody is coming back to already has a way out — delete or finish its sessions, and it leaves the switcher with the last one.

## Turned down

- Hiding it: an unmounted drive would make a project you use every day vanish without a word.
