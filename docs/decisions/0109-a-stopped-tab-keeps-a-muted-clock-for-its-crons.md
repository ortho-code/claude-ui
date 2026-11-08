# A stopped tab keeps a muted clock for its crons

- **Date:** 2026-10-24
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

A tab whose claude has gone keeps the crons its session had when its claude went, and its clock goes on showing them, muted, under "Scheduled when stopped:".
Since every mark was put in the session's menu (2026-10-27), that menu says it too, in the clock's own words.

## Why

Claude's own word on a task can be missed: a notice of claude's went before it could be read (seen 2026-10-22).
A cron's question is answered once.

## Turned down

- A line under the tab's and the strip row's own tooltips, the first version, for which a dimmed clock was turned down (decided 2026-10-24): seen in the app, it raised whether the clock should stay and say something about the schedule, so the clock says it.
