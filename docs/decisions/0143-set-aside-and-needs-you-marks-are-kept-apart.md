# The set-aside and needs-you marks are kept apart

- **Date:** 2026-10-29
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)
- **Partly replaced** by [0215](0215-news-while-set-aside-can-wait-for-its-day.md) on 2026-11-12: with `setAsideNews` at `"wait"`, the order no longer decides, and every reason is muted while the set-aside mark stands; the marks are still kept apart.

## Decision

The set-aside and needs-you marks are kept apart, and the order they came in, by when each was set, decides what shows (`mutedBySetAside`).

## Why

When a session is picked up again, why it needed you should still be there.
