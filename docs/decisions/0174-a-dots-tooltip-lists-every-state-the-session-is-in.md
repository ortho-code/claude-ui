# A dot's tooltip lists every state the session is in

- **Date:** 2026-11-06
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

A session's tooltip and its menu's header list every state the session is in, a line each, in the strength order, the dot's first (`stateLines`).

## Why

A session busy and marked says "Busy" and then why it is marked, so a mark its dot does not show is still there on hover.
The tooltip said the shown state alone until then, and the reasons were ranked by a table of their own: a PR back to work, then finished or open again, then approved, then how the app closed, then a reminder.
One order in the place of three is the reason that table went.
