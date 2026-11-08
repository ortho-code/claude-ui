# A panel type's script describes and the app acts

- **Date:** 2026-09-29
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

A panel type's script only prints; what is done with what it prints is the app's.

## Why

A script that prints can do nothing beyond running unless the person presses something.

## Turned down

- A JavaScript module loaded into the window: it would hold the bridge to every session.
- A sandboxed page: it would need a message API of its own for the same result.
