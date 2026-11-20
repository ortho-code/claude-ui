# A row out of sight is updated when it comes into sight

- **Date:** 2026-11-19
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)

## Decision

A session row the browser has said is out of sight is not brought up to date by a draw or by the minute's clock: a draw owes it the update, made in full from the store as it then is once the browser says the row is in sight again, and the clock leaves its time until then.

## Why

At 1,000 sessions on a slower machine (Chromium's CPU slowed four times), the minute's clock worked out every drawn row's time and tooltip, its longest task about 86 ms, and a search that brought 603 rows back brought each up to date, 327 ms; with the rows out of sight left until they are seen, those took 44 and 218 ms (measured 2026-11-19, medians of two runs each, back to back).
The browser already skips drawing those rows ([0236](0236-rows-out-of-sight-are-not-drawn.md)) and says when that changes, so nothing has to work out where a row is.

## Turned down

- Drawing the rows in slices with the window free between them, as the history does ([0033](0033-history-drawn-in-slices.md)): it spreads the same work over frames, where this leaves out the work nobody sees.
- Working out which rows are in sight from their positions: reading layout is what a draw avoids, and the browser's own answer is free.
- Leaving the time alone but updating the rest: a row's tooltip says its state and its PRs, which a draw of the whole would then still work out for every row.
