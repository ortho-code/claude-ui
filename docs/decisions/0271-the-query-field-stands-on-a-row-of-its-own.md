# The query field stands on a row of its own

- **Date:** 2026-11-25
- **Area:** [Reopening the way you left it](../architecture/window.md#reopening-the-way-you-left-it)

## Decision

The query field is always on screen, on a row of its own under the row of Grouped / Recent, Review and collapse-all, with the help and the filter's toggle at its end.
The toggle opens only the pills and the date presets.
With the field always in sight, a shut filter panel leaves no chips: the field shows the query, and the count, which says "finished" when the finished switch is on, stays under it with Clear.
Whether the panel is open is no longer kept: every launch starts with it shut.

## Why

The field is the filter, so it should be where it can be read and typed into at any moment, not behind a toggle; chips standing in for a shut panel drew the same query a second time.
A row of its own gives the field the sidebar's whole width, which a 320px sidebar needs to show a short query; the row under the header has no room left once Grouped / Recent, Review and two buttons sit on it.
The panel's open state was kept so that a filter left on stayed in sight; the field does that now, so a launch can start with the pills out of the way.

## Turned down

- The field on the row under the header, between Grouped / Recent and Review: too little room at 320px to read a query.
- The field in the header after the switcher: the header is crowded again, and the project's name the first to lose room.
- Keeping the chips under the field: a second drawing of what the field already says.
