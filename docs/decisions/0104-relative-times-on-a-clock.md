# A time that says how long ago is drawn on a clock

- **Date:** 2026-10-22
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)

## Decision

An element showing how long ago something happened is handed to `showMoment` and drawn again every minute while it is in the page.

## Turned down

- Rounding the time into the list's signature: it moves a row whose last activity moves, but a quiet row's never does, and those are the rows it matters for.
- Redrawing the whole list every minute: it reconciles every section and brings every drawn row up to date for one line of text, and reaches no other surface.
