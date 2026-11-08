# A press that asks to see the list brings the layout back from full screen

- **Date:** 2026-11-08
- **Area:** [Full screen](../architecture/panels.md#full-screen)

## Decision

Inside a full-screen terminal area, a press that asks to see the list, such as Show in list or a project's name in the tab bar, brings the layout back.

## Why

A fold and a full screen now answer that press alike.

## Turned down

- Doing nothing visible inside full screen, as it did before: it read as broken.
