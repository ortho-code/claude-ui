# The Editor over a cold tab takes the whole pane

- **Date:** 2026-11-25
- **Area:** [The `editor` type](../architecture/panels.md#the-editor-type)

## Decision

Over a tab that stands alone, with no claude, none starting and no failed start whose terminal is still in view, the Editor's drawer covers the whole pane, with no scrim, as a history opened on that tab does; once the tab starts, it goes back to its place beside the tab, where a standing history closes instead.
The terminal area decides it for anything a panel shows in the drawer, by the tab on show, rather than the Editor asking for it.

## Why

The drawer leaves claude in view beside it so you can go back to it, and a tab with no claude running has nothing there to go back to: the history already took the whole pane for such a tab, and the Editor opening narrower over the same empty pane read as a mistake beside it.
The terminal area is what knows whether a claude runs in the tab on show, so a panel type showing something in the drawer needs no way to ask, and every one stands the same.

## Turned down

- `showInDrawer` taking the state, the Editor asking for the whole pane: every panel type would have to know about cold tabs to get what the history gets for free.
