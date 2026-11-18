# A menu leaves out what cannot be done now

- **Date:** 2026-11-16
- **Area:** [A session whose folder is gone](../architecture/claude.md#a-session-whose-folder-is-gone)

## Decision

A menu leaves out an item that cannot be taken now, a submenu left with no item or header in it, and any rule that would then stand at an end or beside another.
`unavailableItems` in the settings, `"hide"` until you choose otherwise, set to `"dim"` shows such an item dimmed with why as its tooltip, as menus did before.
An entry of a list of what there is, a session's siblings and the checkouts it worked in, stays dimmed with why whatever the setting says, since its being there is what the list says.
A control outside a menu, such as a tab's button, keeps its reason as its tooltip either way.

## Why

A tooltip only repeats what can be read without it ([0225](0225-a-tooltip-only-repeats.md)), and a dimmed item's reason was in its tooltip alone.
A menu holds everything that can be done about what it opened on; what cannot be done now has no place in it.
Whoever would rather have a menu keep one shape from session to session, and an item answer why it cannot be done, has the setting.

## Turned down

- The reason as a second line under the dimmed item: every unavailable item would take two lines, and menus grow too big.
- Dimmed as the default, as before: it keeps a reason behind a hover in every menu that has one.
- Leaving out a finished sibling or a gone checkout too, with the counts beside Siblings and Worktrees counting only what can be opened: a finished sibling and a checkout whose folder went could then be seen nowhere, and a pick of a gone checkout would lose its tick.
