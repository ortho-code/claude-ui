# Whether a project is a git repository is answered by every session there

- **Date:** 2026-10-20
- **Area:** [A session's menu holds everything about it](../architecture/terminal.md#a-sessions-menu-holds-everything-about-it)

## Decision

Whether a project is a git repository is a fact about its folder, so every session the app knows there answers it (`buildProjectTree`'s `known`), not only the ones a filter shows.

## Why

Git can file a session's folder as no repository for the rest of a run when it took too long there, and a filter showing only that session used to take the worktree item away.
