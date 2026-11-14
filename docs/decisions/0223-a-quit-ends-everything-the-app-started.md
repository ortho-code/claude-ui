# A quit ends everything the app started

- **Date:** 2026-11-14
- **Area:** [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question)

## Decision

Quitting the app ends every process it started, everything a panel started included, and not only what the stops of its sessions, shells and runs reach.
Every process the app starts carries an id of that run of the app in `CLAUDE_UI_RUN`, and once the stops have had their wait, a process that carries it and is still in a session the app started, or in the app's own, is asked with `SIGTERM` and killed a second later.
One that carries it but left those sessions, as a daemon does with `setsid`, is logged and left running.
What the app hands to the system to open, a folder or a link, is not the app's to end.
Only Linux, where the processes are read from `/proc`.

## Why

A stop signals a process group, and some processes outlived it: a child that ignores the signal once its leader has left politely, such as a background job started with `nohup`, a PR lookup, which only its own timer stopped, and a git main ran, which only its timeout stopped.
A process the app started and nothing ends any more keeps running with nobody to see it.
The id makes the sweep safe where a group id was not: the id is read again just before each signal, and a process given a pid used again does not carry it.
What left the sessions is only logged for now, because it may be a daemon other terminals use, such as `gpg-agent` after a signed commit or a sync daemon a development tool starts; whether those end too is decided once the log shows what a quit would reach.

## Turned down

- Ending what left the sessions straight away: what that reaches is not known yet, and the log answers it without ending anything.
- Finding them by the session id alone, without the run's id: a reused id could name another program's session once the app's has emptied, and it never reaches what left.
- The app's own `process.env` carrying the id, so every child gets it without each spawn passing it: Electron's processes that it starts after the change would carry it too, and they sit in the app's own session, which the sweep ends while they may still serve the window.
