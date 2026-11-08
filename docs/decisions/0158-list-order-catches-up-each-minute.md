# The session list's order catches up once a minute

- **Date:** 2026-11-04
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)

## Decision

Each minute's tick compares the keys the list would draw now with the keys of the rows on screen, and draws the list again where they differ, except while the pointer, the focus or a menu opened from it is on the list.

## Why

The order used to be the one of the list's last draw, and moved at the next draw for any other reason, a pin or a new session, under the pointer as likely as not.

## Turned down

- A draw at every change of the order: over a week of this machine's transcripts (2026-11-04), a simulated flat list of every session by last activity would have moved a row about 67 times an hour of work in All, nearly all of them sessions in the top five trading places as each running one wrote in turn, the reason a list read while working does not follow recency; checked once a minute, the order had moved in about 13 minutes of each such hour in All.
- Ordering by the last prompt you sent: a row's time says claude's last write, and the order and the time would disagree.
