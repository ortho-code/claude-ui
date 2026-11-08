# The history is drawn in slices, newest first and then oldest up

- **Date:** 2026-09-29
- **Area:** [Opening it, and getting out](../architecture/history.md#opening-it-and-getting-out)

## Decision

The history is drawn in slices with the window free between them: first the newest exchanges, up to 12 ms of work, then the rest from the oldest up, each slice put in just above that newest part.

## Why

Drawn at once, the longest session here (761 requests) held the window for 1–2 s on each switch, and a profile put most of that on the browser laying out the whole new list in one go, not on the app's code.

## Turned down

- Drawing it at once: the longest session held the window for 1–2 s on each switch.
- `content-visibility: auto` on each exchange: it did not cut it, and broke jumps, since positions were then measured against placeholder heights.
- Drawing newest first all the way down: every slice went in above everything already drawn and the browser laid all of that out again, twice the work in total, in slices that grew to 300 ms.
