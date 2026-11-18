# The Editor opens as a drawer, or docks

- **Date:** 2026-11-18
- **Area:** [The `editor` type](../architecture/panels.md#the-editor-type)

## Decision

The Editor opens as a drawer over the terminal area, the drawer the history opens in, and docks beside the terminal from a Dock button in its head; Undock puts it back.
Docked or not is kept for the window, with how it draws a diff, in the view kept for the next launch rather than in any panel's data.
The Editor's view is one for the window, built apart from the layout; the Editor panel in the layout is only where it docks, so `"hidden": true` on it means the Editor never docks, and files still open in the drawer.
The Editor and the history take turns in the drawer; docked, the Editor stays in view while the history opens over the terminal.
While the drawer is open and both have something to show, a rail of icons on its left edge, drawn as a panel group's rail is, switches between them: the one on show lit, a press on it closing the drawer, a press on the other showing that one, the history back where it was when the Editor took the drawer from it; what is docked leaves the rail.
A tab's menu holds Pin, which keeps a preview, Copy path, Close other tabs, Close and Close all; Close all files in the head closes them all at once, docked or not, where Esc and a press on claude close only the drawer and keep the files.

## Why

Opening beside the terminal made the terminal jump narrower at every first file, and showed the file small; a drawer opens at about two-thirds of the pane and moves nothing, and docking is there for reading while working, at the drawer's width.
One drawer for the history and the Editor is one place over the terminal for whatever is looked at for a moment.
Its rail is the panel group's, so the drawer switches as every group does, and says what else it holds without taking a row from either.
A view built apart from the layout is what lets the drawer work with the Editor panel switched off.
The Editor is one per window now, so its choices belong to the window, and survive the panel being renamed, switched off or added by the app.

## Turned down

- A drawer for each file, with only the files kept docked: maybe later; a preview and a kept file in two places at once is more to keep track of than the Editor needs now.
- Keeping docked or not, and the picks, in a fixed key of the panels' data, or under the Editor panel's id: the first misuses a file that is per panel, the second is lost when the panel is switched off or added by the app.
- A switch at the end of the terminal area's tab bar for going between the history and the Editor (decided 2026-11-18): it sits far from the drawer, and in a tab bar already crowded with tabs it is easy to miss.
- "Keep open" for keeping a preview: "Pin" reads as what it does; the files kept per project in the Explorer, later, take another name.
