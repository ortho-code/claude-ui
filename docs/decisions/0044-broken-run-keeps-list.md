# A broken list run never shows an empty list

- **Date:** 2026-09-30
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

A list run that fails, or prints something that is not a list, says so, and a good list already there stays under a line saying when and why it failed.

## Why

An empty queue and a broken one otherwise look the same, and one of them is a lie.

## Turned down

- Blanking the list on every failure: a bad minute on the network would blank it every time.
