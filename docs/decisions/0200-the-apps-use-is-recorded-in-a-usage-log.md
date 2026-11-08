# The app's use is recorded in a usage log

- **Date:** 2026-11-08
- **Area:** [The usage record](../architecture/logs.md#the-usage-record)

## Decision

`usage.log` counts the app's use over weeks: how many sessions were decided, how often the review was used, and how noisy needs-you is.

## Why

The session model's next stages are checked against real use before they are built.
