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

In daily use: the app lists your `~/.claude` sessions grouped by project, runs several
of them at once in tabs with live status cues, and covers the session lifecycle —
start, fork, worktree, pin, archive, delete.

Done:

- Session list from `~/.claude`, grouped into collapsible projects, refreshed live
  as transcripts change on disk.
- Tabs: several sessions open at once, drag to reorder, restored on the next launch.
- Embedded terminal per session (`@xterm/xterm` + `node-pty`): resume on click
  (`claude --resume`), start new sessions, name a session when forking or creating
  a worktree.
- Fork a session (`--fork-session`) and start sessions in a fresh git worktree
  (`claude -w`). Sessions sharing a conversation show as siblings (a fork badge with a
  jump list); worktree sessions file under their main repo with a badge, including
  sessions that entered a worktree mid-life.
- Custom groups: sub-sections inside a project, made from a session's kebab. Move a session
  between them, rename or delete a group (its sessions stay), and start a session, a fork or
  a worktree session straight into one. Open tabs cluster by group in the tab bar.
- Ordering and overview: reorder projects and groups from their kebabs, fold every section
  away and back from one header button, and attach a note to any session.
- Pin, archive, and delete (to the OS trash); search plus filters (pinned, worktree,
  siblings, archived, date range).
- Per-session status dots (busy / idle / waiting) driven by Claude Code hooks scoped
  to app-launched sessions; dots can be marked read, a footer strip surfaces sessions
  needing attention across projects, and a project switcher scopes the sidebar.
- Project rename, app icon, single-instance lock.
- A consistent control system: every mark is an SVG icon (no font glyphs), clickable icons
  share one size and one hover treatment, and radius and type come from tokens.

Next:

- Status nudges that survive an app restart; a performance pass (scroll, open, paste).
- Playwright end-to-end tests, then split view.
- Config viewer, minimize-to-tray, and later a diff / file side panel.
- A readable transcript viewer (after a compaction, the CLI cannot show a resumed
  session's earlier history — the transcript file still has it).
- Reaching a group without scrolling: a jump list on the project heading.
- A taskbar attention nudge requires a native Windows build; parked while the app
  runs under WSLg.

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
