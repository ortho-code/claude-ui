# A loupe reaches one exact entry from the bar

- **Date:** 2026-09-29
- **Area:** [The bar and the loupe](../architecture/history.md#the-bar-and-the-loupe)

## Decision

Hovering the bar opens the loupe, the entries around the pointer in words, which the wheel steps one entry per notch.

## Why

One exact request or reply has to be reachable in a session of hundreds, and at 821 requests the bar has under a pixel per entry, so the pointer alone picks roughly.

## Turned down

- A fisheye on the bar itself, tried in a mock: it spreads the entries under the pointer, but the pointer still moves through them too fast to stop on one.
- A popover from the tab bar: no scrollbar.
- A panel: a layout-file entry today.
- Typing claude's own transcript-mode keys into the pty to move claude's view: it lands wrong when claude is in another state, and nothing says so.
- xterm's own overview ruler: only on claude's default renderer, and its marks go with the process.
