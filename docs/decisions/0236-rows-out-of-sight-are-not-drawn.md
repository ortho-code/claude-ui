# Session rows out of sight are not drawn

- **Date:** 2026-11-18
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)

## Decision

The session list lets the browser skip styling, laying out and painting a row out of sight (`content-visibility: auto`), holding the place of a row it never drew at a one-line row's height.
Every reveal, a jump to a group included, scrolls to its target and keeps it there for the next 8 frames, while the rows around it are drawn for the first time.

## Why

At 1,000 sessions, a status's dot cost 18 ms of paint, the whole list painted again, and a search that brings hundreds of rows back laid all of them out at once; with the rows out of sight skipped, a status change's longest task went from about 30 ms to under 3, and the rows coming back from 116 to 83 ms (measured 2026-11-18).
The history turned the same rule down ([0033](0033-history-drawn-in-slices.md)) because it did not cut the cost there and jumps landed wrong; on the list it cuts the cost, and a jump landed wrong for two reasons, both fixed: the placeholder height was set on top of the row's padding, and the rows around the target are drawn a few frames after the jump, moving it.

## Turned down

- Leaving every row drawn: a status change and a search stay over the performance budgets.
- Correcting a jump only once, or only while it is off: the rows around it are drawn three frames after it, by when a single check had passed.
- Drawing only the rows in sight in the app's own code: it would replace the kept rows a press and the focus rely on.
