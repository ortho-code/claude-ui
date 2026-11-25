# A session view is a panel type of its own

- **Date:** 2026-11-25
- **Area:** [The `session-view` type](../architecture/panels.md#the-session-view-type)

## Decision

A view of the sessions drawn in a panel of its own, such as Now, is a built-in panel type, `session-view`, any number of panels of it, with an option `show` naming the view; the tree draws its header, its switch and its count as a list panel's.
The `sessions` type stays the sidebar, placed exactly once.

## Why

The sidebar is one element for the run, with the switcher, Settings and + New that are the window's, and the layout's only rule a file cannot break is that it is placed exactly once.
Exempting it from that rule when its entry names another view would make the rule depend on an option, and give a bare panel a second header of its own to draw.
A type of its own is not a type for one view: it shows any view with sections, and once the sidebar's filter, folds and bulk mode are a list's own, the sidebar can be one too.

## Turned down

- The `sessions` type with a `view` option, exempt from being placed once for a view with sections.
- A type for Now alone, which a second view would need a second of.
- The option named `view`: a layout entry's `view` is already the pick of its header's switch, which for this panel is the scope.
