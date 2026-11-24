# A session another claude runs is not resumed

- **Date:** 2026-11-24
- **Area:** [Claude tabs](../architecture/claude.md#a-session-another-claude-runs)

## Decision

Before a tab resumes a session, the app reads Claude Code's own record of running sessions, one file per interactive claude in `~/.claude/sessions`, for a claude that runs that session now, whatever started it: a terminal, the Claude desktop app, a script, another tab of the app or another copy of the app.
When it finds one, the tab is not started; it says where that claude runs and since when, and offers Start a copy, which forks the session, Start anyway and Show history.
A fork and a new session are not checked, and a record that cannot be read counts as no claude running, so the start goes ahead as before.

## Why

Two claudes on one session each write their own copy of its transcript.
Once one of them enters or leaves a worktree, Claude Code moves its copy to that folder's project, and the two copies grow apart in two folders; when one is moved back over the other, Claude Code sets the other aside, and with it whatever was said only there.
Claude Code refuses a resume only of a session a background claude holds, not of one another interactive claude runs, so the app checks before it starts one.
The record is Claude Code's own and names the session the claude runs now, while a claude's arguments name it only when it was started with `--resume` or `--session-id` and an id, and still name that one after a `/resume` or `/clear` inside it.

## Turned down

- Reading the session id from the arguments of each running claude: it misses every claude started without an id, such as a new session in the Claude desktop app, `--continue` or `claude -p`, and every claude that has moved to another session since it started.
- Refusing outright, with no way to start: when the other claude is one left idle somewhere, splitting the transcript may be what you want, so Start anyway stays.
- Treating a preview of the app differently, by refusing it sessions or having it fork them: it gets the same check, so whichever copy of the app starts a session second is told.
- Asking Claude Code to refuse a second claude on a session: a fix for every user, but not one the app can wait for.
