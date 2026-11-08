# A terminal panel's shells are tabs inside it

- **Date:** 2026-10-16
- **Area:** [The `terminal` type](../architecture/panels.md#the-terminal-type)

## Decision

The shells are tabs inside the panel, not entries of its group, and the rail keeps one icon per panel.

## Turned down

- Each shell as an entry of the panel's group, switched from the rail, the first plan since a group's rail already switches panels, turned down before building: one glyph for every shell with its name only on hover, no place for `+` or a close, no rail at all in a group of one, two levels on one strip whose shown icon already folds the group, and every shell a panel the layout file does not name, which is still an open question for panels opened at will.
