# A language setting for times and dates

- **Date:** 2026-10-29
- **Area:** [The language](../architecture/window.md#the-language)

## Decision

The app formats times and dates in the language the `locale` setting names, or in the system's while it is `""`, the default.
The calendars take their first weekday from it; this replaced a Monday fixed for every language earlier the same day.

## Why

Chromium reads a machine whose `LANG` is `C.UTF-8`, as a WSL distribution starts, as en-US, so a time field showed AM/PM with no way to change it from the app.
