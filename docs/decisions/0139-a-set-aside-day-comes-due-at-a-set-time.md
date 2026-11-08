# A set-aside day comes due at the time of day the settings give

- **Date:** 2026-10-29
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

A set-aside choice with a day and no time of its own comes due at the time of day the settings give (`setAsideTime`, `"09:00"` by default), in local time.
Pick a date…'s time starts at it.

## Why

In local time, a week on across a change of the clocks is still that time.
