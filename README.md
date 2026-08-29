# claude-ui

A desktop app for running and tracking several Claude Code sessions from one window.

## Why

The existing session managers each miss part of what you want. Claude Code Desktop, Pane, ccmanager, and Claude Squad all put every session in its own git worktree, and none of them combine:

- a session list read straight from `~/.claude`,
- pinning and grouping,
- a full `claude` CLI running in an embedded terminal, with its real approval prompts,
- a per-session cue when a session is waiting for you or has finished.

claude-ui aims for that combination, and runs sessions in the project directory itself instead of forcing a worktree per session.

## Status

In daily use: the app lists your `~/.claude` sessions grouped by project, runs several of them at once in tabs with live status cues, and covers the session lifecycle — start, fork, worktree, pin, archive, delete.

Done:

- Session list from `~/.claude`, grouped into collapsible projects, refreshed live as transcripts change on disk.
- Tabs: several sessions open at once, drag to reorder, and restored on the next launch without starting them — a tab resumes its session when you click it, and its own button stops the session before a second press removes the tab.
- Embedded terminal per session (`@xterm/xterm` + `node-pty`): resume on click (`claude --resume`), start new sessions, name a session when forking or creating a worktree.
- Fork a session (`--fork-session`) and start sessions in a fresh git worktree (`claude -w`).
  Sessions sharing a conversation show as siblings (a fork badge with a jump list); worktree sessions file under their main repo with a badge, including sessions that entered a worktree mid-life.
- Custom groups: sub-sections inside a project, made from a session's kebab.
  Move a session between them, rename or delete a group (its sessions stay), and start a session, a fork or a worktree session straight into one.
  Open tabs cluster by group in the tab bar.
- Ordering and overview: reorder projects and groups from their kebabs, fold every section away and back from one header button, and attach a note to any session.
- Pin, archive, and delete (to the OS trash); search plus filters (pinned, open, running, worktree, siblings, noted, archived, date range).
- Per-session status dots (busy / idle / waiting) driven by Claude Code hooks scoped to app-launched sessions; dots can be marked read, a footer strip surfaces sessions needing attention across projects, and a project switcher scopes the sidebar.
- Project rename, app icon, single-instance lock.
- Opens the way you left it: window size and position, and the sidebar's search, filters, folds, width and scroll offset.
- A consistent control system: every mark is an SVG icon (no font glyphs), clickable icons share one size and one hover treatment, and radius and type come from tokens.
- Reaching a group without scrolling: a jump list on the project heading.
- Settings: default flags for every session the app starts (`--allowedTools Grep,Glob`, for instance), quoted values included.
  The flags the app sets for itself are refused there rather than allowed to break a session.
- Installable builds for macOS and Linux, built on CI from a version tag. See [CHANGELOG.md](CHANGELOG.md) for what each release contains.

Next:

- Status nudges that survive an app restart; a performance pass (scroll, open, paste).
- Playwright end-to-end tests, then split view.
- Stopping or closing a project's or a group's sessions in one go, rather than a tab at a time.
- Config viewer, minimize-to-tray, and later a diff / file side panel.
- A readable transcript viewer (after a compaction, the CLI cannot show a resumed session's earlier history — the transcript file still has it).
- Telling you when a session fails to start, instead of leaving the terminal to explain it.
- A taskbar attention nudge requires a native Windows build; parked while the app runs under WSLg.

## Install a build

The app runs the real `claude` CLI, so **install and sign in to Claude Code first** — without it every session opens on "command not found".

Builds are not published anywhere: ask for the file. The version you are running is in the window title, which is what to quote in a bug report.

**macOS** (Apple Silicon).
Open the `.dmg` and drag the app to Applications.
The first launch is refused, because the app is signed but not notarised — macOS says it "could not verify" it.
Allow it once, either from Terminal:

```bash
xattr -dr com.apple.quarantine "/Applications/Claude UI.app"
```

or by clicking Done, then **System Settings → Privacy & Security**, scrolling to Security, and pressing **Open Anyway**.
On macOS 15 the old right-click-Open trick no longer works.
The step repeats for each new version.

**Linux** (Debian, Ubuntu, and Ubuntu under WSL):

```bash
sudo apt install ./claude-ui-<version>-amd64.deb
```

Use `apt`, not `dpkg -i`: apt pulls in the dependencies the app needs, and `dpkg` fails without them. The same command installs a newer version over an older one, keeping your pins, groups and notes.

For a non-Debian distribution there is an `.AppImage`: `chmod +x` it and run it. It has no install or upgrade step, so updating means replacing the file yourself.

## Run from source

- WSL 2 with WSLg. The app and `claude` both run inside the Linux distribution.
- Node, managed by [mise](https://mise.jdx.dev). Run `mise install` once.
- A C toolchain for the native terminal module: `sudo apt-get install build-essential`.

```bash
mise install
npm install
npm run rebuild   # build node-pty against Electron's ABI
npm start
```

`npm start` builds and launches the app. It runs with `--no-sandbox`, which WSL requires.

To produce installable builds: `npm run dist:linux`, and `npm run dist:mac` on a Mac. Artifacts land in `release/`. Tagging a version builds both on CI and collects them in a draft release.

## Project layout

- `src/main` — Electron main process: window and IPC.
- `src/main/sessions.ts` — reads and summarizes `~/.claude/projects`.
- `src/preload` — the bridge the renderer uses to reach the main process.
- `src/renderer` — the window UI.
- `src/shared` — types and pure helpers shared by both sides.
- `docs/` — architecture and design notes.

## License

MIT — see [LICENSE](LICENSE).
