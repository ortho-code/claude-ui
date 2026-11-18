# A panel's header says when it last refreshed

- **Date:** 2026-11-14
- **Area:** [Several panels in a group](../architecture/panels.md#several-panels-in-a-group)

## Decision

A panel with Refresh says beside it how long ago what it shows came from a run, in the words every "x ago" in the app uses ("just now", "3 min ago"), ageing once a minute, with the moment in full in its tooltip ("Refreshed: …") and in Refresh's ("Last refreshed: …").
The time is that of the last run whose result is on show: a list keeps its last good list when a run fails, so it keeps that list's time and its tooltip adds when the run failed; a command panel shows its last run's output however it ended, so its time is that run's.
A run under way leaves the time of the last one, since the busy mark already says a run is going, even where a command's new run has already cleared the output to show its own.
A panel that shows no run's result, because it cannot run or has nowhere to, shows no time.
A header too narrow for the time and the whole title drops the time first, and Refresh's tooltip still gives it.
There is no setting to switch it off.

## Why

A panel that refreshes on an interval or on a watch said nothing of how fresh its content was until a run failed.
The time beside Refresh is short enough for a narrow panel, and the full moment is one point away, as on every other moment in the app.
A list's time follows the list on show rather than the last run, so the time never claims the list is newer than it is; the failed run is the header's word and the tooltip's second line.
The title names the panel, so it gives way last.

## Turned down

- "Refreshed 3 min ago" in full: twice the room, and the title is cut first.
- The time only in Refresh's tooltip: nothing to see at a glance.
- "refreshing…" during a run: the busy mark says it already, and a short interval would make the header flicker between two words.
- The failed run's time on a list: the list on show is older than that.
- A setting to switch it off: nobody has asked for one; it can be added when someone does.
