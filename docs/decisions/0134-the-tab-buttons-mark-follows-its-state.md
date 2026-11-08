# The tab button's mark follows its state

- **Date:** 2026-10-28
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/terminal.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

The tab button's mark follows the state: a stop square while there is a session to end, a cross or the lidded box once there is only a tab, and for a force the stop square filled, or for a close or a finish the filled square with the cross or the finish's lidded box cut through it.

## Why

So which press you are on is visible.
It was chosen from a mock.

## Turned down

- A filled cross for a forced close: it would look like the plain one.
