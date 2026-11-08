# A rail icon's and a view switch's glyph never turns blue

- **Date:** 2026-10-15
- **Area:** [Sizes and shapes](../architecture/ui-conventions.md#sizes-and-shapes)

## Decision

A rail's icon and a panel's view in its header's switch hover with a fill and a `--text` glyph, and their glyph never turns blue.

## Turned down

- The borderless accent hover: the glyph turned blue under the pointer, and a view's went white once shown, which read as the hover being undone.
- A hover of the glyph alone: it made hover a coloured mark and on show a filled box, two looks rather than two steps of one.
