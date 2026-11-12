# Clear and close ends the filter in one press

- **Date:** 2026-11-12
- **Area:** [Reopening the way you left it](../architecture/window.md#reopening-the-way-you-left-it)

## Decision

Under the open filter panel, Clear and close sits beside Clear: one press empties the filter and shuts the panel.
With the panel shut it is not shown, since there is nothing to close and Clear already leaves nothing on screen.
Clear keeps the panel open, and closing the panel keeps the filter ([0011](0011-closing-the-filter-panel-keeps-the-filter.md)).

## Why

Ending a filter took two presses, Clear and the funnel, in either order, while closing alone keeps the filter on purpose.
A third, explicit press does both without changing what either of the others does.

## Turned down

- Clear closing the panel as well: a Clear meant to start a new filter would then need the funnel again.
- Escape in the search box clearing and closing: today it empties the search text where there is any, the browser's own behaviour for a search box, and leaves the pills, the date and the panel; a stray Escape would then wipe a filter built up from pills and a date.
- A × at the end of the line: a × reads as closing alone, which the funnel already does while keeping the filter.
