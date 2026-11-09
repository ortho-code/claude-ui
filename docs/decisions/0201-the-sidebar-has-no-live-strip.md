# The sidebar has no live strip

- **Date:** 2026-11-08
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

The live strip at the sidebar's foot went.

## Why

The sidebar had a live strip at its foot until 2026-11-08: every running tab and every tab marked as needing you, in every project, each with its tab's button and the session's menu.
It went because it answered two questions on one surface, what needs you and what runs elsewhere, while the project switcher's badge now counts the sessions in other projects that ask for you, and a list panel can name sessions and list what needs you and what runs from the sessions file (`asks`, `running`), with the session's dot, which marks it read, and its menu on each row.
