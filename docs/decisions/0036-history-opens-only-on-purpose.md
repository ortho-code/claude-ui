# The history opens only on purpose

- **Date:** 2026-09-29
- **Area:** [Opening it, and getting out](../architecture/history.md#opening-it-and-getting-out)

## Decision

The history opens only on purpose, from the bar, the arrow at its foot or Ctrl+Shift+↑, and the wheel over a running claude stays claude's.
This is the second version; the first was tried and reversed after use.

## Why

The point of the app is to work in a session, not to read it.

## Turned down

- Taking the wheel, the first version: xterm asks `attachCustomWheelEventHandler` before it sends a mouse report or turns the wheel into arrow keys, so answering false kept the wheel from claude, and a wheel up over the alternate screen handed the pane to the history, scrolling on past its end handing it back; it read well as "scrollback that remembers everything", but in use a scroll that turned into another mode was a surprise, and claude's own wheel scrolling was gone.
- A floating pill at the foot and End as the exit: it was not found.
