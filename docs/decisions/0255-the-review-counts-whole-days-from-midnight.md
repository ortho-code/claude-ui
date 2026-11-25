# The review counts whole days from midnight

- **Date:** 2026-11-25
- **Area:** [The review](../architecture/session-list.md#the-review)

## Decision

The review's two numbers of days count whole days from today's midnight: Untouched 30+ days holds a session last active before the start of the day 30 days ago (`active:<today-30d`), and Keep holds a session out while it was kept on or after that day's start (`-kept:>=today-30d`).
A session joins Untouched, and comes back after Keep, when the day turns, up to a day later than counting from the moment would, a day and an hour across a clock change.

## Why

The review is written in the query language, where a time field's value is always a day, a date or one counted from today, so each thing has one way to say it and `<` always means before.
Counting from the moment would need a second anchor beside `today`, two ways to say a time that differ only by the hours, for a review whose rows wait days anyway.

## Turned down

- `now-30d` beside `today-30d`, keeping the review's bound to the hour: a second way to write a time for a difference nobody acts on.
- A duration field, `untouched:>30d`, beside `active:`: two fields for one question, how long ago a session was last active.
