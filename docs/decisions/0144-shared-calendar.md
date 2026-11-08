# The calendar is one module and stylesheet

- **Date:** 2026-10-29
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)

## Decision

The calendar the filter's date range and Pick a date… both draw, its palette and its weeks from the language's first day, lives in `calendar.ts` and `calendar.css`.

## Why

A rule several modules draw sits in a stylesheet of its own beside what owns it, and is never copied into each.
