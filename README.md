# claude-ui

A desktop app for running and tracking several Claude Code sessions from one window.

## Why

The existing session managers each miss part of what you want. Claude Code Desktop,
Pane, ccmanager, and Claude Squad all put every session in its own git worktree, and
none of them combine:

- a session list read straight from `~/.claude`,
- pinning and grouping,
- a full `claude` CLI running in an embedded terminal, with its real approval prompts,
- a per-session cue when a session is waiting for you or has finished.

claude-ui aims for that combination, and runs sessions in the project directory itself
instead of forcing a worktree per session.

## Status

Milestones 1 and 2 work: the app lists your `~/.claude` sessions grouped by
project, and clicking one opens a terminal in that session's folder.

Roadmap:

- M1 (done) — session list from `~/.claude`, grouped by project.
- M2 (done) — embedded terminal per session, a login shell in the session's
  folder (`@xterm/xterm` + `node-pty`).
- M3 — resume a session on click (`claude --resume`, done); pin and group next.
- M4 — waiting/done cues driven by Claude Code hooks.

## Requirements

- WSL 2 with WSLg. The app and `claude` both run inside the Linux distribution.
- Node, managed by [mise](https://mise.jdx.dev). Run `mise install` once.
- A C toolchain for the native terminal module: `sudo apt-get install build-essential`.

## Install and run

```bash
mise install
npm install
npm run rebuild   # build node-pty against Electron's ABI
npm start
```

`npm start` builds and launches the app. It runs with `--no-sandbox`, which WSL requires.

## Project layout

- `src/main` — Electron main process: window and IPC.
- `src/main/sessions.ts` — reads and summarizes `~/.claude/projects`.
- `src/preload` — the bridge the renderer uses to reach the main process.
- `src/renderer` — the window UI.
- `src/shared` — types shared by both sides.
- `docs/` — architecture and design notes.

## License

MIT
