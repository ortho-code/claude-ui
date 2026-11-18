# Every menu is capped at 300px, its first line cut and the rest wrapped

- **Date:** 2026-10-27
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)
- **Partly replaced** by [0225](0225-a-tooltip-only-repeats.md) on 2026-11-15: the first line wraps as the lines under it do, with no tooltip.

## Decision

Every menu is capped at 300px: the first line, the session's name, stays one line, cut when too long and carrying its whole text as its tooltip; the lines under it wrap, a path too long for a line breaking wherever the line runs out.

## Why

A name read from its transcript runs to 200 characters.
Wrapping the lines under it means what they say is all there.
