# Show in list widens the list to All

- **Date:** 2026-10-19
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)

## Decision

Show in list widens the list to All when it shows another project, rather than choosing the session's project.

## Why

All holds every tab, so the one on show stays.

## Turned down

- Choosing the session's project: choosing a project moves the tab bar and the tab on show with it, which took you out of the tab you were in when it was built that way.
- Making it unavailable on another project: from a panel's row, which is often about another project, it would hardly ever be available.
