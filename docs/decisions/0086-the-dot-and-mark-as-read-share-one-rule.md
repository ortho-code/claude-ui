# A session's dot and Mark as read share one rule

- **Date:** 2026-10-19
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)

## Decision

Mark as read and the dot share one rule (`canMarkRead`): only when there is something to mark is the dot a control, painted and pressable.

## Why

The dot used to look pressable for every status while a click did nothing for most of them.
