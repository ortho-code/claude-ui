# The sessions file gives each session's rank

- **Date:** 2026-11-17
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

The sessions file a list run is given ([0152](0152-sessions-snapshot-per-run.md)) says of each session its `rank`, where what its dot shows stands in the strength order, and `muted`, whether its set-aside mark holds its reasons back; its reasons come in the order the app ranks them.
The order itself is not in the file.

## Why

A type that sorted by its own copy of the order drifted from the app: merged PRs sorted near the top there and last in the app.
The dot's rule, which weighs claude's status against the reasons and lets a muted mark give way to claude, is the app's to apply, so a type is given its outcome rather than the parts to work it out from.
Whether a mark is muted depends on `setAsideNews`, which a type is not given.

## Turned down

- The whole order and every category in the file, for a type to rank by itself: each type would copy the dot's rule, and the copies would drift; the order comes when a type wants to group its rows by category.
- `rank` counting the mute, with a muted session last: it would differ from the dot, and a type could no longer tell where the session stands once its mark goes.
- A `rank` per reason: no type reads one yet.
