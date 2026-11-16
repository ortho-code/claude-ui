# A panel's folder mark opens a menu

- **Date:** 2026-11-16
- **Area:** [Where a panel runs: the `cwd` option](../architecture/panels.md#where-a-panel-runs-the-cwd-option)

## Decision

A press on a panel's folder mark, or Enter on it, opens a menu: the folder's name in full and the path the panel's run goes to, then the session's list of where the panels look, as its worktree badge opens it, and Copy path.
With no session on show, the list is left out.

## Why

The mark cuts the folder's name when the header is narrow, and the path and how a pick lets go were on its hover alone ([0225](0225-a-tooltip-only-repeats.md)).
A pick was made from the session's worktree list, while the panel the pick moves had nothing to press; the menu brings the list to where the pick shows.
A kebab comes only with actions ([0228](0228-a-panel-rows-tooltip-stays-on-hover-and-a-kebab-comes-with-actions.md)), and this menu has them: the picks and Copy path.

## Turned down

- A dashed badge to say a pick holds: the star a pinned session wears already says it without a hover.
- Marking a pick visibly and leaving the path on hover: the cut name and the path stay out of reach for whoever does not hover.
