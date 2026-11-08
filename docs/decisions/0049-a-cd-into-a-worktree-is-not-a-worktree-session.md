# A Bash cd into a worktree does not make a worktree session

- **Date:** 2026-10-07
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

A Bash `cd` into a worktree changes the `cwd` the records carry and nothing else, so it counts as neither entering a worktree nor leaving one.

## Why

Claude Code records no worktree session for it, and a resume runs where the session started.

## Turned down

- Counting it: any record in a worktree would badge a one-off look inside one, and a share of the records would be a threshold nothing can check.
