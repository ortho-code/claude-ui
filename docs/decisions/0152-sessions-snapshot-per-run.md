# Every list run gets a snapshot of the sessions

- **Date:** 2026-11-02
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

Every list run gets the sessions the app has, in a file built per run by the window and named in `CLAUDE_UI_SESSIONS`, and live values keep the rows it chose current between runs.

## Why

A type can choose its rows from them, and the rows it chose stay current without a run.

## Turned down

- One file main kept current: main would need every change pushed to it and atomic writes, for a reader outside a run that nobody has.
