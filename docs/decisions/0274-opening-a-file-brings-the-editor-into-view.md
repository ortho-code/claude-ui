# Opening a file brings the Editor into view

- **Date:** 2026-11-26
- **Area:** [The `editor` type](../architecture/panels.md#the-editor-type)

## Decision

Every file opened in the Editor brings the Editor into view where it stands, as a press on its rail icon would, and out of another panel's full screen: docked, the Editor panel; in the drawer, the terminal area the drawer stands in.
Either comes in front of the other panels of its group, its group unfolded, and the layout comes back when another panel fills the window.
That holds for every way of opening one: a row of the Explorer, a file in the history, and a path claude prints.

## Why

Opening a file opens the drawer, but the drawer is only in sight where the terminal area is, and a docked Editor only where its panel is: a file opened behind another panel, in a folded group or under another panel's full screen opened where nobody could see it, and a line a link asked for was lost there.
Each panel already had a way to bring itself into view, which the toasts and the session asks use, so the Editor asks it rather than the layout learning about the Editor.

## Turned down

- Bringing it into view only for a link or the history, leaving the Explorer's rows alone: with the Explorer and the Editor, or the terminal, in one group, a press on a row would open the file behind the Explorer, the same lost open; the Explorer is then one rail press away.
- Keeping another panel's full screen, the Explorer's or the terminal's: a file opened there would open out of sight, and the way back to the layout is one press either way.
