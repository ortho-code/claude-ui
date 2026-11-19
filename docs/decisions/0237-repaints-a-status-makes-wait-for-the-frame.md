# The repaints a status makes wait for the frame

- **Date:** 2026-11-18
- **Area:** [The store](../architecture/processes.md#the-store)

## Decision

A store watcher can ask to be told once a frame rather than at once: at the next animation frame, once for every change before it, with what moved since its last call.
The project switcher, both rail icons, the panels' session marks and the Review button's count ask for it; every other watcher is still told at once.
A watcher can wait only where it is the one painter of what it draws.

## Why

Parallel tool results bring up to 20 status events in a second, often in one task, and each recounted the switcher and the rail over every session: at 1,000 sessions, twenty in one task held the window for about 40 ms, and 90 ms on a slower machine (measured 2026-11-18).
Told once a frame, they cost what one does.
The session list's dots and the tab bar's are each painted by two watchers, the draw of the whole and a follower that repaints only what moved since its own last call; deferred, the follower missed a needs-you mark that was drawn and settled in one task, and the dot kept it.

## Turned down

- Telling every watcher once a frame: a flow that draws and then measures, such as revealing a row, would measure what was there before.
- Deferring the list's dots and the tab bar's too: they missed a change that came and went between their two painters, and they cost little.
- A debounce on the status events from main: the window would show a status late, not only paint it later.
