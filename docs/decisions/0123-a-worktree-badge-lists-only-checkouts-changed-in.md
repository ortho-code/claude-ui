# A worktree badge lists only the checkouts a session changed files in

- **Date:** 2026-10-28
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

Only a change counts for the checkouts a session's worktree badge lists, as for the work folder.

## Turned down

- The worktrees on the records' `cwd`: of the 17 sessions on one machine (2026-10-26) whose records reach a worktree the badge does not name, 9 changed nothing there with claude's file tools, where the changes name 12: 8 of those 17, and 4 that ran in or left a worktree and changed files in the main checkout, 2 of them in another worktree by path as well, which the records' worktrees leave out.
