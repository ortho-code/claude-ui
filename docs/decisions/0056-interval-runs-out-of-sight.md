# A command panel's interval runs out of sight too

- **Date:** 2026-10-07
- **Area:** [The `command` type](../architecture/panels.md#the-command-type)

## Decision

A `command` panel's `interval` runs it while hidden or folded too, by the list kind's timing through the same `RunGate`.

## Why

It keeps the rail's red dot true, and "does a panel's interval run out of sight" has one answer for both kinds.

## Turned down

- A run on show when one is due and none while hidden: it makes an hourly overview late by its own run time each time it is looked at.
