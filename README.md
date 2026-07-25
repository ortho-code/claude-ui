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

The core is working: the app lists your `~/.claude` sessions grouped by project,
clicking one resumes it in an embedded terminal, you can pin sessions, and each
shows a live status dot.

Done:

- Session list from `~/.claude`, grouped by project.
- Embedded terminal per session (`@xterm/xterm` + `node-pty`).
- Resume a session on click (`claude --resume`).
- Pin sessions to the top.
- Per-session status dots (busy / idle / waiting) driven by scoped Claude Code hooks.

Planned:

- Multiple open sessions: tabs first, with split view and pop-out windows as add-ons.
- Collapsible groups; worktree sessions filed under their main repo with a badge.
- Search, live auto-refresh, custom session names, an app icon, a single-instance lock,
  and a taskbar attention nudge.
- Custom groups (deferred).

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
