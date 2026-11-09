# Each session keeps the history of its needs-you reasons

- **Date:** 2026-11-06
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

Each session keeps the history of its reasons (`needsYouHistory` in `meta.json`): a reason that is settled moves there, as it stood, with when it was settled and by what.
