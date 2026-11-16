# A tooltip only repeats what can be read without it

- **Date:** 2026-11-15
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)
- **Partly replaced** by [0228](0228-a-panel-rows-tooltip-stays-on-hover-and-a-kebab-comes-with-actions.md) on 2026-11-16: what a panel type puts in a row's, a section heading's or a part's `tooltip` shows on hover alone, and may say more than the row shows.

## Decision

A tooltip only repeats what can be read somewhere without hovering.
Text may be cut only in a strip of a fixed size, such as a session row, a tab, a panel's header, a heading or the project switcher's title, and then the text in full is one press away, in the menu it opens or, for a filter chip, in the filter panel.
A menu, a popover and a notification have room to grow, so they wrap rather than cut: a menu's header, every menu item's label, the project switcher's list and a notification's title and project wrap in full.
A name with no break point, such as a folder name, breaks wherever the line runs out.

## Why

A tooltip shows only to a pointer that rests on the right spot, and only once the pointer gets there: what lives only there is out of sight for whoever does not know to look.
A session's name in its menu was cut with its whole text on hover, the session list a panel row opens and a project's group list cut their names with nothing on hover, the switcher cut a project's name in its list as well as in its title, and a notification cut the name of the session that called, most of them going away after five seconds.

## Turned down

- A menu's first line wrapping to three lines and then a "Show the whole name" line in the header: one more press, and a control inside what is not an item.
- Menus wider than 300px: fewer names cut, not none, since a session's name runs to 200 characters.
- A menu item's label wrapping to at most two lines and cut at the end of the second, to keep menus short: only a session list a panel row opens has items that open a menu with the name whole, while a PR's title opens the browser and the PRs list is where it is read in full, and the siblings', worktrees' and groups' names wrapped in full already.
- The switcher's title wrapping too: the top of the sidebar would grow a line for a long name and move everything under it; one press opens the list, where the name is whole.
- A notification's title wrapping to two lines: the session is named once and the toast mostly goes away.
- The history's loupe wrapping its rows: it steps one entry per notch ([0037](0037-loupe-for-exact-entries.md)), keeping the entry stepped to in view by arithmetic on rows of one height (`ROW` in `bar.ts`), and a press opens the entry in full.
