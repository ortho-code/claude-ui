# A shared settings file needs no trust step

- **Date:** 2026-10-05
- **Area:** [The config folder](../architecture/config.md#the-config-folder)

## Decision

A `settings.json` from somebody else needs no trust step, its launch flags included, though they reach every session you start without a press.

## Why

What a shared settings file says is for its reader to check, as it is with Claude Code's own, and Settings shows it.
