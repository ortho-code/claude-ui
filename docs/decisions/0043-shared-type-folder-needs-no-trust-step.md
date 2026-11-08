# A shared panel type folder needs no trust step

- **Date:** 2026-09-29
- **Area:** [The config folder](../architecture/panels.md#the-config-folder)

## Decision

A type folder a colleague shared needs no trust step: it runs as you, the way a script in `scripts/` does.

## Why

What makes that acceptable is that a type can do nothing beyond running its script without being pressed.
