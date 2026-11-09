# A tab can no longer be paused

- **Date:** 2026-10-29
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

Pause went: setting a session aside is the set-aside mark, the session's rather than its tab's, which leaves the tab as it is.
A launch reads the paused tabs an older `meta.json` lists as sessions set aside, and restores their tabs as ordinary cold ones.

## Why

Until 2026-10-29 a cold tab could also be paused: set aside with a mark of the tab's own, Pause in its menu asking a running claude to leave as a stop does, with a force of its own, and the live strip listing the paused tabs with what ran.
The tabs you paused were kept in the same write as the open tabs, `pausedSessions`.
It went because the paused tabs only ever grew, 10 of 34 open tabs by then, and it took a leave, a force and a dot of its own.
