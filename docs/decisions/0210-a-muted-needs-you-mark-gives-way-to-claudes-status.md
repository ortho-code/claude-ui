# A muted needs-you mark gives way to claude's status

- **Date:** 2026-11-11
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

Where a set-aside mark mutes a session's needs-you reasons, claude's status shows over them on the dot and in every roll-up, whatever the strength order says; where the status is closed or there is none, the order decides, as for any session.
So a claude at its prompt, not yet read, shows ready and counts as asking for you; a muted reason with nothing else to show stays dimmed, as read, with its reason in the tooltip, wherever the order ranks it over closed, as the default does.

## Why

The dot picked one state by the order first, and only then read a muted reason as read.
With the default order a reason ranks over ready, so a claude that finished its turn in a session set aside after its reason showed only the dimmed reason and counted for nothing, though the turn itself was never read.
Working and waiting rank over reasons and so always showed; ready was the one status lost.

## Turned down

- Leaving it to the strength order, with ready placed before the reasons: that fixes it only for whoever changes the order, and changes every unmuted dot too.
- Leaving muted reasons out of the dot altogether: a session set aside with no status would then show nothing, where the dimmed reason says why it was marked.
