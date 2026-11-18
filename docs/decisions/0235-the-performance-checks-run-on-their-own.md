# The performance checks run on their own

- **Date:** 2026-11-18
- **Area:** [The performance checks](../architecture/build-and-checks.md#the-performance-checks)

## Decision

The window's performance budgets are held by checks of their own, `npm run test:perf`, on the window checks' harness, run by hand before a change that can slow the session list, and never in `npm test`, `npm run test:renderer` or CI.
Each runs at the machine's own speed and with Chromium's CPU slowed four times over, at 1,000 sessions.
A status change and the other live updates are held by their longest task, at most a frame (16 ms), rather than by their script alone.

## Why

Budgets written only in a document are re-checked by nobody, and the list's drawing had grown slow without anyone timing it: at 1,000 sessions a key in the search took about 300 ms, and over 900 ms slowed down (measured 2026-11-18).
A timing on a shared CI runner varies with whatever else runs there, so a gate there would flake, or pass only with margins wide enough to hold nothing.
The list grows by every session not deleted, so the budgets are set at 1,000 sessions rather than at today's count, and colleagues run the app on slower laptops, which the slowed run stands in for.
A check can read the longest task directly, while the script's own share needs the profiler, which slows what it measures.

## Turned down

- The budgets in a document only: nothing would notice them broken.
- A gate in CI: retries or wide margins would make it meaningless.
- Holding a live update to 8 ms of script: only the profiler can tell script apart, and it changes the timings it reads.
