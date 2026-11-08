# An object setting is written entry by entry

- **Date:** 2026-11-08
- **Area:** [The config folder](../architecture/panels.md#the-config-folder)

## Decision

A setting whose value is an object is written entry by entry where the file's value is used (`fileEdits`).

## Why

A Reset of one `needsYou` id then edits that entry alone, and the comments around the others stay.

## Turned down

- Writing the value whole, as before: it lost every comment inside the value.
