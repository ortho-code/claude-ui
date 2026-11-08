# A group folds from a faint chevron on a divider

- **Date:** 2026-09-23
- **Area:** [Dividers and folding](../architecture/panels.md#dividers-and-folding)

## Decision

A `collapsible` group folds from a chevron on a divider.
The chevron is faint until the pointer is on its divider, and full then.

## Why

A divider takes no room anywhere else.
A faint chevron is quieter than a row of buttons on every foldable divider, and easier to find than a chevron that only appears on hover.
All of these were tried in a clickable mock.

## Turned down

- A header row: a bare group does not have one.
- A button placed in the panel's own bar: the chevron on a divider won over it in the mock.
- A row of buttons on every foldable divider: louder than a faint chevron.
- A chevron that only appears on hover: harder to find.
