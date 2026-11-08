# A borderless icon control hovers by turning its glyph accent

- **Date:** 2026-10-08
- **Area:** [Sizes and shapes](../architecture/ui-conventions.md#sizes-and-shapes)

## Decision

A borderless icon control turns its glyph `--accent` on hover, and nothing else.

## Why

Without a box around the glyph, controls can sit as close as their marks allow.
Accent is a saturated blue, where `--text` is the same greyish blue as the resting `--muted`, only lighter.

## Turned down

- Filling and outlining as well, as it used to: it needs a box around the glyph, and once a kebab's box hugged its dots, that box ran into the title and the button beside it.
- `--text`, tried first: it is the same greyish blue as the resting `--muted`, only lighter.
