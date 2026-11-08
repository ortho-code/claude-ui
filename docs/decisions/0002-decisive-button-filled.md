# A dialog's decisive button is filled, its colour named once

- **Date:** 2026-08-29
- **Area:** [Sizes and shapes](../architecture/ui-conventions.md#sizes-and-shapes)

## Decision

A dialog's decisive button is filled, and each colour is named once, as a `--fill` custom property.

## Why

`button:hover` sets an accent border app-wide, so a resting accent border is indistinguishable from an ordinary button being hovered.

## Turned down

- The old accent-outlined Save: it read as an ordinary button being hovered, which is why it was replaced.
- `currentColor`, the text colour, which an earlier version reached for: it hovered to a dark border on the blue button, which read as shrinking, and a white ring on the red one.
