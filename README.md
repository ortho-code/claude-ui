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
- Custom groups: sub-sections inside a project, made empty from the project's kebab or around a session from its kebab.
  Move a session between them, rename or delete a group (its sessions stay), and start a session, a fork or a worktree session straight into one.
  Open tabs cluster by group in the tab bar, and a group's name there takes you to the group in the list.
- Ordering and overview: reorder projects and groups from their kebabs, fold every section away and back from one header button, and attach a note to any session.
- Pin, archive, and delete (to the OS trash); search plus filters (pinned, open, running, worktree, folder gone, siblings, noted, archived, date range).
  A filter left on with its panel shut stays on screen as a row of chips, one per thing that is on, above the count.
- Per-session status dots (busy / idle / waiting) driven by Claude Code hooks scoped to app-launched sessions; dots can be marked read, a footer strip surfaces sessions needing attention across projects, and a project switcher scopes the sidebar.
  A session in the strip can be muted or stopped where it is listed, so acting on one in another project doesn't cost you the project you're looking at.
  The strip keeps still: it follows your tabs, clustered by group, so a row only moves when you move a tab.
- Sessions are followed the way they actually run: stopping one escalates until it has really ended, a `/clear` carries on in the same tab and group as a new session, and a `/model` switch shows at once.
- A session whose folder is gone says so, in its row and on its tab, and refuses to start, instead of starting somewhere nobody chose; pinning, notes, archiving and deleting still work.
  A project whose folder is gone says so too, in the project switcher, on its heading and in the tab bar.
- Project rename, app icon, single-instance lock.
- Opens the way you left it: window size and position, and the sidebar's search, filters, folds, width and scroll offset.
- A consistent control system: every mark is an SVG icon (no font glyphs), clickable icons share one size and one hover treatment, and radius and type come from tokens.
- Reaching a group without scrolling: a jump list on the project heading.
- Settings: default flags for every session the app starts (`--allowedTools Grep,Glob`, for instance), quoted values included.
  The flags the app sets for itself are refused there rather than allowed to break a session.
- The window's layout is yours to arrange, in a file you edit by hand: rows and columns of panels, the sidebar and the terminal among them, sized in shares or pixels, with dividers to drag and panel groups that fold to a strip of icons.
  Panels so far run a command or a script and show its output, or give you a plain shell, in the folder you are working in or one you pin them to; each checks its own settings and says in its place what is wrong. See [Panels](#panels).
- Installable builds for macOS and Linux, built on CI from a version tag. See [CHANGELOG.md](CHANGELOG.md) for what each release contains, and [UPGRADING.md](UPGRADING.md) if a version needs a manual step.
- A log file per launch and day, so a problem in an installed build can be looked at afterwards; a launch that crashed keeps its log for longer. See [Install a build](#install-a-build) for where it is.
- A history of each session, from its transcript and laid out as claude shows it: every request, message and tool call since the session began, compactions included, with pins for the ones to come back to.
  A bar beside the terminal marks them all and works as the history's scrollbar, pressed or dragged, a loupe on it steps through a long session one entry at a time, and Ctrl+Shift+↑ and ↓ step between your requests.
- Panel types of your own, from a folder in the config folder: a script prints a list and the app draws it, with links, sections that fold, and a count on the panel's icon kept current on an interval. See [Panel types of your own](#panel-types-of-your-own).

Next:

- Starting a Claude session from a row of a list panel, such as a review of the PR it names, in the project and group you pick; and the row leading back to the session it started.
- Panel types that draw themselves: a page of your own in a sandboxed frame, fed by its script, asking the app for what it cannot do itself, such as opening a link or starting a session.

- Letting you answer when Claude asks something on its way out — whether to keep a worktree, say — instead of the tab closing over the question.
- A worktree session keeping its worktree badge after the app restarts.
- Context health per session in the list, coloured the way the CLI's own status line colours it.
- Clickable paths in terminal output, opening the file the session just named in a panel.
- Status nudges that survive an app restart; a performance pass (scroll, open, paste).
- Playwright end-to-end tests, then split view.
- Stopping or closing a project's or a group's sessions in one go, rather than a tab at a time.
- More panel types (markdown, diff, transcript, config), and layouts per project.
- Panels opened at will rather than only from the file, such as a second shell, and panels that belong to one project while others stay the same everywhere.
- Minimize-to-tray.
- Telling you when a session fails to start, instead of leaving the terminal to explain it.
- History: file changes under their tool calls (the diffs behind Edit and Write, and claude's result summaries), syntax colouring in code blocks, another look at its type, and tuning the bar and its loupe.
- History: search within it, and one list of every pin across sessions, with a way to clear pins no session opens any more.
- History: reading a session's history without starting it, from the session list, and showing an entry in claude's own view as well as the app's.
- A taskbar attention nudge requires a native Windows build; parked while the app runs under WSLg.

## Panels

A layout file arranges the window: rows and columns of panel groups, with the sidebar and the terminal area as two of the panels.
It lives in the app's config folder, which Settings shows with an Open button:

- Linux: `~/.config/claude-ui/config/`
- macOS: `~/Library/Application Support/claude-ui/config/`

Write `layouts/default.json` there, and the app picks it up as you save.
Without a file — or after you delete or rename yours — the window is the default layout below, so there is always a way back to one that works.
The app never writes to this folder, so it is yours to edit, version, or hand to a colleague.

The default layout, as a starting point to copy:

```json
{
  "version": 2,
  "root": { "id": "window", "columns": [
    { "id": "sidebar", "size": "320px", "min": 220, "panels": [{ "id": "sessions", "type": "sessions" }] },
    { "id": "claude", "panels": [{ "id": "cli", "type": "claude" }] }
  ] }
}
```

Every node has an `id` and exactly one of `rows`, `columns` or `panels`: `rows` and `columns` split the space, and `panels` makes a panel group, which shows one panel at a time.
A node can also have:

| Field | Meaning |
|---|---|
| `size` | A share of its parent (`0.25`), or pixels (`"320px"`). Pixels keep their size when the window resizes and shares divide the rest; children without a size share what is left. |
| `min` | The smallest it gets, in pixels; 120 when absent. |
| `resizable` | `false` fixes its size: the divider beside it cannot be dragged. |
| `collapsible` | `true` lets a panel group fold to a strip of icons, from the chevron on its divider. |
| `active` | The panel a group shows first. |

Drag a divider to resize the two nodes beside it, and double-click it to go back to the sizes in the file: once you have dragged a divider, a `size` you change in the file does not move it until you double-click.
A panel group that can fold has a faint chevron on its divider, which brightens when you point at the divider.
The sizes you drag to, the groups you fold and the panel you pick in a group are remembered on this machine, not written to the file.
A group with several panels switches between them from a strip of icons on its edge: hovering an icon names the panel, and a dot on it says a command failed or a session is waiting for you.
Clicking the icon of the panel on show folds a group that can fold, and clicking any icon of a folded group unfolds it on that panel.

Every id, of a node or a panel, is unique in the file and uses lowercase letters, digits, hyphens and underscores.
A panel needs an `id` and a `type`; `title`, `icon` and `hidden` are optional, and whatever the type itself takes goes under `options`.
`icon` picks its icon by name: `git`, `list`, `check`, `eye`, `bug`, `book`, `clock`, `server`, `play`, `search`, `bell`, `terminal`, `command`, `sessions`, `claude` or `alert`.
A panel that cannot run wears `alert` whatever it names, so a broken one stands out on a strip of icons too.

The panel types:

- `sessions` is the sidebar and `claude` is the terminal area with its tabs.
  Each belongs in the file exactly once: one left out is added back, and a second copy says where the first one is, so no file can leave you without the terminal.
- `command` runs something and shows what it printed, given one of two ways in its `options`: `command`, a command line run by your login shell as you typed it, or `script`, the path to an executable. `cwd` picks the folder it runs in.
- `terminal` is a plain shell, the same login shell your sessions run in. `cwd` picks the folder it starts in.
- A folder under `types/` in the config folder is a type of your own, named after the folder; see [Panel types of your own](#panel-types-of-your-own).

This one puts a shell in a drawer under the terminal area and two commands behind icons on the right, and lets the sidebar, the drawer and the right side fold:

```json
{
  "version": 2,
  "root": { "id": "window", "columns": [
    { "id": "sidebar", "size": "320px", "min": 220, "collapsible": true, "panels": [{ "id": "sessions", "type": "sessions" }] },
    { "id": "main", "rows": [
      { "id": "claude", "panels": [{ "id": "cli", "type": "claude" }] },
      { "id": "drawer", "size": 0.3, "collapsible": true, "panels": [{ "id": "shell", "type": "terminal" }] }
    ] },
    { "id": "right", "size": "360px", "collapsible": true, "panels": [
      { "id": "status", "type": "command", "icon": "git", "options": { "command": "git status --short" } },
      { "id": "checks", "type": "command", "title": "Checks", "icon": "check", "options": { "script": "scripts/checks.sh" } }
    ] }
  ] }
}
```

A relative `script` resolves against the config folder, so `scripts/` is the place to keep one, and it has to be executable; `~/` works too.
It never resolves against the project, so switching to a repo cannot run that repo's file in place of yours. To run a project's own script, say so with a command line such as `"command": "./bin/status"`, which runs in the project's folder.

The command runs in the active tab's folder, or the selected project's root when no tab is open, and runs again when you switch project or tab or press Refresh.
While it is out of sight, behind another panel or folded away, it does not run; it runs once when you show it again, if the folder changed meanwhile.
It sees these variables:

| Variable | Value |
|---|---|
| `CLAUDE_UI_PROJECT_ROOT` | the selected project's repo root, empty without one |
| `CLAUDE_UI_CWD` | the folder the command runs in |
| `CLAUDE_UI_SESSION_ID` | the active tab's session, empty without one |
| `CLAUDE_UI_CONFIG_ROOT` | the config folder |

Output is shown as plain text (`NO_COLOR` and `TERM=dumb` are set, and escape codes are stripped), a non-zero exit shows as `exit N`, a run still going after 30 seconds is stopped, and output is cut at 1 MB.

A `terminal` panel's shell starts in that folder too, the first time you show it, but stays there when you switch tab or project, since a shell may have something running in it.
The header names the folder it is in, and the button restarts it in the current one.
When the shell exits, the panel says so, and any key starts a new one in the current folder.
It keeps running while hidden or folded, and while you edit the layout file around it.
It gets the same variables, and a `claude` you start in it by hand is not tracked as one of the app's sessions.

Either type takes a `cwd` in its `options` to run somewhere other than that folder:

- An absolute path, or one under `~/`, is fixed: the panel runs there whatever is selected, even with no project at all. A command with one does not run again when you switch project or tab, since its folder has not moved; Refresh runs it. A terminal with one has no button, and a key starts a new shell there after the old one exits.
- A relative path is under the active tab's folder, or the project's root, so `"cwd": "packages/api"` follows the project into that folder.

```json
{ "id": "notes", "type": "command", "icon": "git", "options": { "command": "git status --short", "cwd": "~/notes" } }
```

The variables tell the panel where it runs: `CLAUDE_UI_CWD` is that folder, and the project and session are the ones selected when it ran or started.

A mistake in the file — an unknown type, a missing id, a size it cannot read, an option the type does not have, a script that is not there or not executable — is named in the place of the thing that is wrong, and a file that does not parse leaves the last good layout up and names the position.
A panel's options are checked by the panel itself, when it appears and before each run, so a missing script is named a moment after the rest.

### Panel types of your own

A folder under `types/` in the config folder is a panel type, named after the folder, so a type is shared by copying its folder.
It holds a `panel.json` and the script it runs:

```json
{ "version": 1, "kind": "list", "title": "Reviews", "icon": "check", "run": "queue", "interval": "5m", "options": [{ "name": "for", "kind": "text" }] }
```

`kind` is `list`, the one kind so far: the script prints a list, and the app draws it.
`run` is the script, relative to the type's folder and inside it, and it has to be executable.
`title` and `icon` are what a panel of the type shows when its entry names none, and `interval` runs it again on its own, every `30s`, `5m` or `1h`, at least every 10 seconds.
`options` names settings of the type's own; the script gets each as `CLAUDE_UI_OPTION_<NAME>` (so `for` is `CLAUDE_UI_OPTION_FOR`), beside the variables above.

The layout then uses it by name, and its entry can pin the folder the script runs in and override the interval:

```json
{ "id": "reviews", "type": "reviews", "options": { "cwd": "~/development/scienta", "for": "me", "interval": "10m" } }
```

The script prints one JSON object on stdout, and nothing else; what it writes on stderr is kept for when it fails.

```json
{ "version": 1, "badge": 2,
  "sections": [
    { "empty": "Nothing waiting on you.", "items": [
      { "key": "org/repo#1", "text": "Fix the login redirect", "detail": "#1 · 3d · someone", "href": "https://github.com/org/repo/pull/1", "tone": "attention" }
    ] },
    { "title": "Blocked", "shut": true, "items": [] }
  ],
  "notes": [] }
```

Each item needs a `key`, unique in the list, and a `text`; `detail` is a second line, `href` an http or https link a click opens in your browser, and `tone` is `normal`, `attention`, `muted` or `danger`.
A section with a `title` has a heading that folds it, and `shut` starts it folded; `empty` is what it says with no items.
`badge` is a count shown on the panel's icon and beside its title, and `notes` go in the line under the panel.
A field the app does not know is ignored, so a script written for a later version still shows here.

The panel runs its script when you first show it, on Refresh, when you switch project or tab if its folder moves, and on its interval even while it is out of sight, so the count on its icon stays current.
A run that fails, or prints something that is not a list, never shows as an empty list: with a list already there, the list stays under a line saying when the run failed and why, and without one the panel says it is unavailable, quoting the end of what the script wrote on stderr.
A mistake in `panel.json` is named where each panel of the type would be, and a folder named like a built-in type is not read, with a note saying so.
A type you were sent runs as you, the way a script in `scripts/` does, so read it before you drop it in; everything a panel does beyond running its script, such as opening a link, is something you press.

## Install a build

The app runs the real `claude` CLI, so **install and sign in to Claude Code first** — without it every session opens on "command not found".

Builds are not published anywhere: ask for the file. The version you are running is in the window title, which is what to quote in a bug report.

Send the log along with it: **Settings → Logs → Open** shows the folder, `~/.config/claude-ui/logs/` on Linux and `~/Library/Logs/Claude UI/` on macOS.
There is a file per launch and day, named for the moment it started, and a launch that crashed or ended without quitting keeps its file as `…-crash.log`.
The files record what the app did — sessions starting and ending, and what failed — and not your prompts or conversations, apart from the last few lines a session printed if it failed to start.
The app removes old files itself, keeping the last 7 days it ran and the 20 newest crash logs, and any of them is safe to delete.

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
