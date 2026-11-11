# A new needs-you reason is unread

- **Date:** 2026-11-11
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

Marking a session as needing you takes its read mark off, as a new status from claude does.
That holds for a reason that replaces an older one of its kind too, such as a PR's next change replacing that PR's last one.
A set-aside day coming takes the read mark off as well, whether it brings the reminder or lights up the reasons the set-aside mark muted.
Putting reasons back, as Undo of a close or a finish does, leaves the read mark as it is.

## Why

A read mark says you have seen what the dot shows.
A reason that came after it is something you have not seen, so a session marked read kept a dimmed dot, counted for nothing in the roll-ups, and sat muted in a list of what needs you, while its PR had a conflict.
A PR's next change is marked because the PR changed since the app last looked, so a replacing reason is news as much as a first one.
The day coming is news too: it is the moment you chose to be told to come back, so reasons you had read before setting the session aside light up unread.
Undo puts back what you had already seen, so it is no news.

## Turned down

- A replacing reason leaving the read mark: a PR whose checks fail after its conflict was read would arrive read, which is the case this fixes.
- A day coming leaving the read mark on a session whose reasons you had read: the day would pass with no sign, which is what setting it aside until then was meant to give.
- Clearing the read mark only for reasons of some types: every type is something that changed, and which ones matter is already yours to choose by switching types off.
