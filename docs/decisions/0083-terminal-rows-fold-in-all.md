# A terminal panel's rows fold to one in All

- **Date:** 2026-10-16
- **Area:** [The `terminal` type](../architecture/panels.md#the-terminal-type)

## Decision

In All a terminal panel's header has a row per project, each led by the project's name, and the rows fold to one from the tab bar's own fold chevron.

## Turned down

- A header capped at about two rows that scrolls: tabs scrolling in a 28px header are fiddly to hit, and nothing else in the app scrolls tabs.
- One row without the projects' names: tabs of different projects mix and look alike.
