# An open kebab menu follows what it lists

- **Date:** 2026-10-21
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)

## Decision

While a kebab menu is up, every change to the store lists its items again, and where they differ from what it shows it is drawn and placed again under its trigger.

## Why

A menu left open does not go on offering what can no longer be done, such as Force stop for a session claude has since left.

## Turned down

- A snapshot, built at the click and kept until it closed, as before: it went on offering what could no longer be done.
