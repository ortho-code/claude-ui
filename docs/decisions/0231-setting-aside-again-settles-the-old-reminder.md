# Setting aside again settles the old reminder

- **Date:** 2026-11-17
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

Setting a session aside through Set aside… settles the reminder an earlier set-aside mark left, into its history as `set-aside`, in the same write as the new mark; every other reason stays, muted by the new mark.
Set aside…'s Undo gives the reminder back, and putting a mark back, as a finish's Undo does, settles nothing.

## Why

The reminder is the earlier mark's, about a day that has passed, and the new mark brings its own.
Left standing, it stayed listed beside the new mark, and when the new day came it was the old day's reminder that lit up, since a session that already needs you gets no new one.

## Turned down

- Settling "was running" too: it says how the app closed, news about the work rather than about the old mark, and the new mark mutes it when set, as it mutes every reason from before it.
- Recording it as `replaced`: that says a newer reason of the same kind took the old one's place, and the two would no longer be told apart in the history and the usage record.
- Settling it inside every write of a set-aside mark: a mark Undo puts back is the old mark, which stood beside that reminder before, not a new choice, so nothing takes the reminder's place.
