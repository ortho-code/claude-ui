# The sidebar's header actions take the ordinary button's hover

- **Date:** 2026-10-15
- **Area:** [Sizes and shapes](../architecture/ui-conventions.md#sizes-and-shapes)

## Decision

The header actions (`.large`) take the ordinary button's hover, `--surface-hover` with an accent border, leaving `--active` to say what a sidebar button opened is up.

## Turned down

- Hovering the header actions to `--active` as well: the filter looked the same hovered and open, and + New, a plain button, hovered to `--surface-hover` beside them and turned, while its picker was open, the `--active` they hovered to.
