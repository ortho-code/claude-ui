# The history docks beside the terminal

- **Date:** 2026-11-18
- **Area:** [Opening it, and getting out](../architecture/history.md#opening-it-and-getting-out)

## Decision

Dock in the history's head puts it in a column beside the tab's terminal, inside the terminal area, with a divider that drags its width; Undock puts it back in the drawer.
Docked or not, and the column's width, are kept for the window, as the Editor's Dock is, and the column first takes about the drawer's width, two-thirds of the pane and at least 560px, shrinking with a narrower pane.
Docked, opening the history leaves the keys where they were, the bar and Ctrl+Shift+↑ and ↓ scroll it, ↓ past the last request leaves it open, the history does not take Esc, and Close hides the column while Dock stays on.
A cold tab has no terminal to dock beside, so its history stands over the pane as before, with no Dock; resuming the tab closes it, and it opens docked the next time.
The terminal refits while the divider is dragged, as it does for every divider of the layout.
The drawer covers the terminals and the docked history together, so a file opened while the history is docked slides in over both from the right, just left of the history's bar, the side the default layout docks the Editor on, and the history is back in view when it closes.

## Why

The drawer is for a look; reading back while working in the session needs both in view at once, and claude at full width under a scrim is not working in it.
Kept per window as the Editor's Dock is, so what the drawer holds docks the same way whichever it is, each with its own Dock.

## Turned down

- Docked or not, and the width, kept per tab for the run, as where the history was left is: the Editor's Dock is per window, and the two would answer the same question differently.
- Refitting the terminal only once the drag ends: a second behaviour for one kind of divider, where every layout divider refits as it moves.
- The drawer over the terminals only, between claude and the docked history: the Editor's drawer then sat away from where the default layout docks it, and docking it moved it to the other side of the history.
- The docked history left of claude, so the drawer over the terminals would sit on the side the Editor docks on: the history would sit away from its bar.
- Making the docked history a panel of the layout: it is the tab on show's history, and belongs to the terminal area, beside the tab's own terminal.
