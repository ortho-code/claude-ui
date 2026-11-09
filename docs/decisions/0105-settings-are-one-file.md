# Settings are one file, not a pair

- **Date:** 2026-10-22
- **Area:** [The config folder](../architecture/config.md#the-config-folder)

## Decision

The settings are one file, `settings.json`.
They were a pair until 2026-10-22, `settings.local.json` beside `settings.json`.

## Why

They are written only when Settings saves, where none of the reasons the layout keeps a pair weighs much.
The pair cost every setting lines saying which file its value came from, with a button back to the other.

## Turned down

- A pair, `settings.local.json` beside `settings.json`, as the layout keeps: it cost every setting lines saying which file its value came from, with a button back to the other.
