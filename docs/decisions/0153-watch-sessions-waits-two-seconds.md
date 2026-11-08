# Watching the sessions waits 2 seconds after the last change

- **Date:** 2026-11-02
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

`watch: sessions` hears of every change to the snapshot's slices and compares once none has come for 2 seconds.

## Why

2 seconds is the moment of one turn's end, its status and its read mark landing together.

## Turned down

- A fixed poll, as git's 30 seconds: too slow for a session waiting for you.
