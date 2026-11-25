# A row's state colour is its dot's alone

- **Date:** 2026-11-25
- **Area:** [Views with sections](../architecture/session-list.md#views-with-sections)

## Decision

A session row in a view with sections shows the colour of its state only in its dot, in the look the state has; its left edge keeps saying that the session has a tab, live or cold, as on every other surface.

## Why

A session row's left edge already says it has a tab, and Now's rows are those rows, so a running session would need two marks on one edge.
The dot already shows the state in its look's colour, and the looks are the one place a state's colour is set, so an edge would repeat it.

## Turned down

- The look's colour on the left edge as the list panel Now replaces had a tone there: one edge, two meanings.
- The look's colour on the right edge: a second edge with a meaning of its own.
- The list panel's own tones (danger, attention, positive): a second answer to what colour a state is, beside the looks.
