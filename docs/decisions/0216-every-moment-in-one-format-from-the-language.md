# Every moment in one format, from the language

- **Date:** 2026-11-12
- **Area:** [The language](../architecture/window.md#the-language)

## Decision

Every moment the app gives in full is written in one format, from the language of the `locale` setting: its weekday, day and month as the language writes them, then its time to the minute, with the year only for a moment in another year.
That covers a time's tooltip, which now also says what the moment is ("Last active:", "Finished:", "Sent:"), the set-aside mark and dialog, and a reminder's needs-you line.

## Why

A time's tooltip followed the language, with seconds and a numeric date, while the set-aside mark and dialog wrote "Tue 3 Nov, 09:00" in English whatever the language, so one window gave two forms of a date.
A bare date in a tooltip did not say what it was: on a row of the review it read as when its PR merged while it was the session's last activity.

## Turned down

- The app's own English "Tue 3 Nov, 09:00" everywhere: it ignores the language setting, which exists so that dates read the way the person reads them.
- A date format setting apart from the language: nobody has asked for a format other than their language's yet.
