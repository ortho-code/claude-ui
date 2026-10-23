# claude-ui

A desktop app for running and tracking several Claude Code sessions from one window.

## Why

The existing session managers each miss part of what you want.
Claude Code Desktop, Pane, ccmanager, and Claude Squad all put every session in its own git worktree, and none of them combine:

- a session list read straight from `~/.claude`,
- pinning and grouping,
- a full `claude` CLI running in an embedded terminal, with its real approval prompts,
- a per-session cue when a session is waiting for you or has finished.

claude-ui aims for that combination, and runs sessions in the project directory itself instead of forcing a worktree per session.

## Status

In daily use: the app lists your `~/.claude` sessions grouped by project, runs several of them at once in tabs with live status cues, and covers the session lifecycle — start, fork, worktree, pin, archive, delete.

Done:

- Session list from `~/.claude`, grouped into collapsible projects, refreshed live as transcripts change on disk.
- Tabs: several sessions open at once, drag to reorder, and restored on the next launch, where the sessions that were running come back paused, or start again if you choose, and the rest wait — a tab resumes its session when you click it, and its own button stops the session before a second press removes the tab.
  A session that asks something on its way out, such as whether to keep its worktree, is answered in its tab, which stays until claude has gone, its dot pulsing meanwhile; one that has not gone a second later can be forced.
  A tab can be paused, from its kebab or a right-click: claude ends and the tab stays, marked with two bars, to set it aside without keeping it running, and it comes back paused at the next launch until you open it again.
- Embedded terminal per session (`@xterm/xterm` + `node-pty`): resume on click (`claude --resume`), start new sessions, name a session when forking or creating a worktree.
  The tab bar folds to one row, the row of the tab on show where there is one, from a chevron on the line under the tabs, to give the terminal the room; while a tab folded away is waiting for you, or has finished and is not marked read, the chevron turns into its status dot.
- Fork a session (`--fork-session`) and start sessions in a fresh git worktree (`claude -w`).
  Sessions sharing a conversation show as siblings (a fork badge with a jump list); worktree sessions file under their main repo with a badge, including sessions that entered a worktree mid-life, and a session that has since left its worktree keeps the badge, muted.
- The PRs a session links, as Claude Code records them in its transcript: a badge on its row that lists them, an entry in its options, and each opening its page in the browser; a filter finds the sessions with one, and search finds a session by a PR's number.
  The badge takes the colour of what GitHub says of them — changes requested, failing checks or a merge conflict, ready to merge, all merged or closed — asked with `gh`, and each PR GitHub has answered for is listed with its state.
- Custom groups: sub-sections inside a project, made empty from the project's kebab or around a session from its kebab.
  Move a session between them, rename or delete a group (its sessions stay), and start a session, a fork or a worktree session straight into one.
  Open tabs cluster by group in the tab bar, and a group's name there takes you to the group in the list.
- Ordering and overview: reorder projects and groups from their kebabs, fold every section away and back from one header button, and attach a note to any session.
- Pin, archive, and delete (to the OS trash), a project whose sessions are all archived staying in the list until they are deleted; search plus filters (pinned, open, live, paused, worktree, siblings, linked PR, noted, archived, folder gone, date range).
  Archive is unavailable while a session runs, so it is stopped first, and the app does not open an archived session again until you unarchive it.
  A filter left on with its panel shut stays on screen as a row of chips, one per thing that is on, above the count.
- A session's kebab holds everything about it, one menu on its row, its tab and the live strip: what the session is, at its top — title, project, group, status, when it was last active and on what model, when it was archived, worktree, the start of its note — and the actions its row, tab and strip row offer, such as open, show in list, pin, mark read, stop or close, besides fork, siblings, PRs, note, group, copy id, pause and archive.
  An archived session's row has one too, with what it is, its siblings, PRs and note, its id, unarchive and delete.
  A project's and a group's kebab start a session there, plain or in a worktree, and a project's starts one in any of its groups, a group a filter hides included, and jumps to one of its groups or to its ungrouped sessions.
- Per-session status dots (busy / idle / waiting, and working in the background when a turn ends with work it started still running) driven by Claude Code hooks scoped to app-launched sessions; a dot can be marked read while its session is idle or waiting and not archived, a live strip at the foot of the sidebar lists what is running and what is paused across projects, and a project switcher scopes the sidebar.
  A session in the strip can be muted, stopped, paused or closed where it is listed, from its button or its kebab, so acting on one in another project doesn't cost you the project you're looking at.
  A running session whose last turn left a task scheduled, a `/loop` wakeup or a cron of the session's own, shows a clock beside it, naming each task on hover, and what becomes of a `/loop` wakeup and of a cron when the session ends.
  The strip keeps still: it follows your tabs, clustered by group, so a row only moves when you move a tab.
  A project can be hidden from the strip while you focus elsewhere, counted on a Hidden line that still shows what it asks of you, until you pick it from that line's menu or open or start a session there.
- Sessions are followed the way they actually run: stopping one escalates until it has really ended, a `/clear` carries on in the same tab and group as a new session, and a `/model` switch shows at once.
- A session whose folder is gone says so, in its row and on its tab, and refuses to start, instead of starting somewhere nobody chose; pinning, notes, archiving and deleting still work.
  A project whose folder is gone says so too, in the project switcher, on its heading and in the tab bar.
- Project rename, app icon, single-instance lock.
- Opens the way you left it: window size and position, the sidebar's search, filters, folds, width and scroll offset, and the tab bar's fold.
- A consistent control system: every mark is an SVG icon (no font glyphs), clickable icons share one mark size and one hover for each kind, a borderless one turning accent blue, a bordered one filling, the header's buttons hovering as the ordinary button beside them does, and a panel's icon in a strip filling as a tab does, and radius and type come from tokens.
- Reaching a group without scrolling: a jump list on the project heading.
- Settings: default flags for every session the app starts (`--allowedTools Grep,Glob`, for instance), quoted values included.
  The flags the app sets for itself are refused there rather than allowed to break a session.
  They are kept in the config folder, over a `settings.json` of your own; see [Settings](#settings).
- The window's layout is yours to arrange, in a file you edit by hand: rows and columns of panels, the sidebar and the terminal among them, sized in shares or pixels, with dividers to drag and panel groups that fold to a strip of icons.
  Panels so far run a command or a script and show its output, again on an interval, when the script says, or when the git working tree of their folder changes, or give you plain shells, as tabs per project that come back at the next launch, in the folder you are working in or one you pin them to; each checks its own settings and says in its place what is wrong.
  See [Panels](#panels).
- Installable builds for macOS and Linux, built on CI from a version tag.
  See [CHANGELOG.md](CHANGELOG.md) for what each release contains, and [UPGRADING.md](UPGRADING.md) if a version needs a manual step.
- A log file per launch and day, so a problem in an installed build can be looked at afterwards; a launch that crashed keeps its log for longer.
  See [Install a build](#install-a-build) for where it is.
- A history of each session, from its transcript and laid out as claude shows it: every request, message, tool call and subagent's report since the session began, compactions included, with pins for the ones to come back to.
  A bar beside the terminal marks them all and works as the history's scrollbar, pressed or dragged, a loupe on it steps through a long session one entry at a time, and Ctrl+Shift+↑ and ↓ step between your requests.
- Panel types of your own, from a folder in the config folder: a script prints a list and the app draws it, with links, sections that fold, and a count on the panel's icon kept current on an interval.
  See [Panel types of your own](#panel-types-of-your-own).
  A row can start a Claude session with a first prompt, such as a review of the PR it names, in the project and group you pick; it then shows that session's status and leads back to it, and a second press offers to continue it.
- The sidebar and the terminal area are panel types like the others, each drawn by modules of its own.
- A config folder that stays yours: the settings in `settings.json`, which you edit and Settings saves into, keeping your comments, and your layout, which the app never writes, keeping where you left it — the sizes you drag to, the groups you fold — in a `.local.json` file of its own beside it, in your file's own field names.
  Every file there may carry comments and trailing commas.

Next:
- Options and documentation for the sidebar and the terminal area, starting with the terminal area's tabs on or off.
- Panel types that draw themselves: a page of your own in a sandboxed frame, fed by its script, asking the app for what it cannot do itself, such as opening a link or starting a session.
- A list row leading back to a session it did not start, such as the one that opened a PR, found by the branch they share.
- A panel type marking the sessions its rows started, on their rows and tabs in the session list.
- The PRs a session was started to review, told apart from the PRs it opened, found through the panel row that started it.
- Opening every link in a list panel at once, asking first when there are many.
- A folder of its own for a panel type's script, to keep state between runs, such as an item snoozed for a day.
- Options of a path kind in a panel type's manifest.
- A panel's heading set from its layout entry, or by the panel itself.
- A panel type's own look over the app's, for a type that wants one; until it says otherwise, its rows look like the app's.
- A Panel data row in Settings: what each panel remembers about the sessions its rows started, whether that panel is still in the layout, and a way to clear it.

- Context health per session in the list, coloured the way the CLI's own status line colours it.
- Clickable paths in terminal output, opening the file the session just named in a panel.
- Status nudges that survive an app restart; a performance pass (scroll, open).
- End-to-end tests of the built app with a stand-in `claude`, now that the window's own checks run headless; then split view.
- Visual regression checks: reference pictures of the window, made on CI, which a change to the look updates on purpose.
- A Renovate configuration of the repo's own, tuned to its dependencies and workflows rather than left at Renovate's defaults.
- Stopping or closing a project's or a group's sessions in one go, rather than a tab at a time.
- A jump into the session list, from a tab or the live strip, bringing the list into view when it is folded or behind another panel.
- Named layouts, several in `layouts/` with the one in use chosen in settings, and blocks: parts of a layout kept in files of their own and used in it by name, as often as you like.
- More panel types (markdown, diff, transcript, config), and layouts per project.
- Panels opened at will rather than only from the file, and panels that belong to one project while others stay the same everywhere.
- A terminal panel's shells listed from its icon on a strip, to reach one in a folded group, and marked on their tabs while a command runs and when it ends out of sight.
- Minimize-to-tray.
- Telling you when a session fails to start, instead of leaving the terminal to explain it.
- History: file changes under their tool calls (the diffs behind Edit and Write, and claude's result summaries), syntax colouring in code blocks, another look at its type, and tuning the bar and its loupe.
- History: search within it, and one list of every pin across sessions, with a way to clear pins no session opens any more.
- History: reading a session's history without starting it, from the session list, and showing an entry in claude's own view as well as the app's.
- History: claude's tool use quieter still than folding edits in with reads and commands, such as tool lines drawn quieter, and folds that start open or shut by kind or remember which you opened.
- A taskbar attention nudge requires a native Windows build; parked while the app runs under WSLg.

## Panels

A layout file arranges the window: rows and columns of panel groups, with the sidebar and the terminal area as two of the panels.
It lives in the app's config folder, which Settings shows with an Open button:

- Linux: `~/.config/claude-ui/config/`
- macOS: `~/Library/Application Support/claude-ui/config/`

Write `layouts/default.json` there, and the app picks it up as you save.
Every file in the folder is JSON that may also carry comments (`//` and `/* */`) and trailing commas.
Without a file — or after you delete or rename yours — the window is the default layout below, so there is always a way back to one that works.
The app writes `settings.json` at a launch that finds none, when you save in Settings, and once at a launch to move settings kept elsewhere before into it, and the files whose names end in `.local.json`, which hold where you left a layout on this machine, such as the sizes you drag to, and win over the file of yours beside them.
Every other file is yours and the app never writes it, so it is yours to edit, version, or hand to a colleague; a `.local.json` holds nothing secret and may go along, with this machine's sizes in it, and a folder you keep in git can leave them out with `*.local.json` in its `.gitignore`.

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
| `folded` | `true` starts a group that can fold folded, until you unfold it. |
| `active` | The panel a group shows first. |

Drag a divider to resize the two nodes beside it, and double-click it to go back to the sizes in the file.
A panel group that can fold has a faint chevron on its divider, which brightens when you point at the divider.
The sizes you drag to, the groups you fold and the panel you pick in a group are kept in `layouts/default.local.json` beside your file, which the app writes, by node id, in your file's own field names, and win over yours:

```jsonc
{
  "nodes": {
    "sidebar": { "size": "280px" },
    "drawer": { "size": 0.25, "folded": true },
    "right": { "active": "checks" }
  }
}
```

To keep one for good, move its field into your file; a `size` you change in your file counts at once for a node you have not dragged.
A group with several panels switches between them from a strip of icons on its edge: hovering an icon names the panel, and a dot on it says a command failed or a session is waiting for you.
Clicking the icon of the panel on show folds a group that can fold, and clicking any icon of a folded group unfolds it on that panel.

Every id, of a node or a panel, is unique in the file and uses lowercase letters, digits, hyphens and underscores.
A panel needs an `id` and a `type`; `title`, `icon`, `view` and `hidden` are optional, and whatever the type itself takes goes under `options`.
`icon` picks its icon by name: `git`, `list`, `tree`, `check`, `eye`, `bug`, `book`, `clock`, `server`, `play`, `search`, `bell`, `terminal`, `command`, `sessions`, `claude` or `alert`.
`view` picks, by id, the view a panel shows until another is picked in its header, for a type that offers several, such as a list of files flat or as a tree; an edit of it shows from the panel's next run, and a pick in the header is kept on this machine instead.
A panel that cannot run wears `alert` whatever it names, so a broken one stands out on a strip of icons too.

The panel types:

- `sessions` is the sidebar and `claude` is the terminal area with its tabs.
  Each belongs in the file exactly once: one left out is added back, and a second copy says where the first one is, so no file can leave you without the terminal.
- `command` runs something and shows what it printed, given one of two ways in its `options`: `command`, a command line run by your login shell as you typed it, or `script`, the path to an executable.
  `cwd` picks the folder it runs in, `interval` how often it runs again on its own, and `watch` whether it runs again when that folder's git working tree changes.
- `terminal` holds plain shells, the same login shell your sessions run in, as tabs in its header.
  `cwd` picks the folder they start in, and `scope` whether its tabs are the selected project's (`project`) or the same in every project (`global`).
- A folder under `panel-types/` in the config folder is a type of your own, named after the folder; see [Panel types of your own](#panel-types-of-your-own).

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
It never resolves against the project, so switching to a repo cannot run that repo's file in place of yours.
To run a project's own script, say so with a command line such as `"command": "./bin/status"`, which runs in the project's folder.

The command runs in the active tab's folder, or the selected project's root when no tab is open, and runs again when you switch project or tab or press Refresh.
While it is out of sight, behind another panel or folded away, a switch does not run it; it runs once when you show it again, if the folder changed meanwhile.

An `interval` in its `options`, such as `"5m"` or `"1h"`, from `"10s"` to `"24h"`, also runs it again that long after each run ends, out of sight too, so the dot on its icon stays current; a panel with one runs as soon as it is placed, at launch or when you add it, even out of sight.
While its output is on show, a run on the interval leaves it, the header's word and the dot as they are until it ends, then shows what it printed, failed or not, so the panel does not empty under you, and stays scrolled where it was as far as the new output reaches.
Refresh and a switch still clear it, and show the run as it prints.

```json
{ "id": "overview", "type": "command", "icon": "git", "options": { "script": "scripts/overview.sh", "cwd": "~", "interval": "1h" } }
```

A run can also say when it runs next, which suits a script that knows when its answer will change better than a fixed interval does.
`CLAUDE_UI_CONTROL` names a file of the run's own, and a line `next=5m` written to it runs the panel again five minutes after the run ends, for that once, in place of the `interval` or without one; `next=off` leaves it until something else runs it.
It is held to an interval's `10s` to `24h`, a `next` outside them running at the bound it crosses, it runs out of sight as an interval's run does, and a line, a name or a last `next` the app cannot read is a note on the group's note line.

```sh
# Every minute while the working tree has changes, every hour once it is clean.
if [ -n "$(git status --porcelain)" ]; then echo "next=1m"; else echo "next=1h"; fi >> "${CLAUDE_UI_CONTROL:-/dev/null}"
```

`"watch": "git"` runs it again when the git working tree of the folder it runs in changes: an edit, a new file, a stage, a commit or a checkout there, and not what git ignores.
The app asks git about it every 30 seconds between runs, out of sight too, and runs the panel once the tree has stayed the same for one of those looks, so claude writing ten files is one run; what changes while a run goes, the run's own writes included, runs nothing, and a switch of tab or project is a switch, not a change.
A folder that is not in a git working tree says so in the panel's place, and a press of Refresh looks again; when git cannot answer the panel's check, the panel says why and asks again every 30 seconds, three times, then stops asking until something looks again, such as Refresh.

```json
{ "id": "status", "type": "command", "icon": "git", "options": { "command": "git status --short", "watch": "git" } }
```

The command sees these variables:

| Variable | Value |
|---|---|
| `CLAUDE_UI_PROJECT_ROOT` | the selected project's repo root, empty without one |
| `CLAUDE_UI_CWD` | the folder the command runs in |
| `CLAUDE_UI_SESSION_ID` | the active tab's session, empty without one |
| `CLAUDE_UI_CONFIG_ROOT` | the config folder |
| `CLAUDE_UI_CONTROL` | a file of the run's own, read when it ends: `next=…` there says when it runs next; unset in the rare run whose file could not be made, which the log names |

Output is shown as plain text (`NO_COLOR` and `TERM=dumb` are set, and escape codes are stripped), a non-zero exit shows as `exit N`, a run still going after 30 seconds is stopped, and output is cut at 1 MB.

A `terminal` panel holds shells, each a tab in its header where the title would be, and makes none by itself: where there is none it says so, and New terminal there, or any key, makes one, in All under the project of the session tab on show; with no session tab on show in All, it asks you to pick a project first.
`+` after the last tab makes another, and each starts in the folder a command would run in, named after it, but stays there when you switch tab or project, since a shell may have something running in it.
A tab's tooltip names its folder, and its kebab, or a right-click, renames it, which a double-click does too, restarts its shell in the current folder, or closes it.
A restart stays in the tab's own project: in All, unless the session tab on show is in that project, it starts at the project's root, or where `cwd` says, under the root when it is relative.
Its cross or a middle-click closes it too, and while a command runs in the shell, closing or restarting it asks first, naming the command.
Drag a tab to move it along its row.
The tabs are the selected project's, and a switch ends no shell: the other projects' keep running out of sight, as a shell does while hidden or folded, and while you edit the layout file around it.
In All every project's tabs show, a row each led by the project's name, and a chevron on the header's bottom line folds them to the row of the tab on show.
When a shell exits, its screen says so, and any key in it starts a new one in the same folder.
The tabs come back at the next launch, with their names, and each shell starts again when its tab is shown, in the folder it was in when the app quit, on Linux; on macOS, or for a shell that had already exited, in the folder it was made or last restarted in.
What was on screen in them does not come back.
Each shell gets the same variables, but a shell filed under a project names that project whatever is selected, and the session on show only when that session is in that project; one filed under none, as under a `global` scope, names what is selected.
A `claude` you start in a shell by hand is not tracked as one of the app's sessions.

Either type takes a `cwd` in its `options` to run somewhere other than that folder:

- An absolute path, or one under `~/`, is fixed: the panel runs there whatever is selected, even with no project at all.
  A command with one does not run again when you switch project or tab, since its folder has not moved; Refresh runs it, and so does its `interval`.
  A terminal with one starts every shell you make or restart there, and shows the same tabs in every project unless its `scope` is `project`.
- A relative path is under the active tab's folder, or the project's root, so `"cwd": "packages/api"` follows the project into that folder.

```json
{ "id": "notes", "type": "command", "icon": "git", "options": { "command": "git status --short", "cwd": "~/notes" } }
```

The variables tell the panel where it runs: `CLAUDE_UI_CWD` is that folder, and the project and session are the ones selected when it ran or started, except for a shell filed under a project of its own, as above.

A mistake in the file — an unknown type, a missing id, a size it cannot read, an option the type does not have, a script that is not there or not executable — is named in the place of the thing that is wrong, and a file that does not parse leaves the last good layout up and says what is wrong and at which line and column.
A panel's options are checked by the panel itself, when it appears and before each run, so a missing script is named a moment after the rest.

### Panel types of your own

A folder under `panel-types/` in the config folder is a panel type, named after the folder, so a type is shared by copying its folder.
It holds a `panel.json` saying what the type is, and a script that prints a list, which the app draws: rows with links, sections that fold, a count on the panel's icon kept current on an interval, and buttons that start a Claude session with a prompt you see, and can change, before it starts.
A row that started a session then shows that session's status and leads back to it.

[docs/panel-types.md](docs/panel-types.md) is the whole of it: what goes in the folder, what the script is given and prints, what the app does with it, and an example type to copy.

A type you were sent runs as you, the way a script in `scripts/` does, so read it before you drop it in; everything a panel does beyond running its script, such as opening a link or starting a session, is something you press.

## Settings

The settings are in `settings.json` in the config folder (see [Panels](#panels) for where it is), which you can edit by hand and which Settings saves into.
A launch that finds none writes one with every setting at its default, under a line saying what each is; a default written there stays as it is, so a later version's new default is in force only where you delete that line.
For example:

```jsonc
{
  // Grep and Glob without asking, in every session
  "launchFlags": "--allowedTools Grep,Glob",
  // The sessions that were running when the app closed start again at launch
  "runningSessionsAtLaunch": "start",
  // Don't ask GitHub what it says of the sessions' PRs
  "prStatus": false
}
```

There are three settings: `launchFlags`, the default flags for every session the app starts, `runningSessionsAtLaunch`, what a launch does with the sessions that were running when the app closed, and `prStatus`, whether the app asks GitHub what it says of the PRs your sessions link.
`runningSessionsAtLaunch` is `"pause"` until you choose otherwise, which brings their tabs back paused, in the live strip, without starting them; `"start"` starts them again, and `"leave"` brings their tabs back with the other tabs, waiting for a click.
A tab you paused comes back paused whichever it is.
`prStatus` is `true` until you choose otherwise, which colours each session's PR mark by what GitHub says, asked with `gh` on your own login; `false` asks nothing, and the marks keep one colour.
A save writes the settings you changed, and puts a value Settings can use in place of one in the file it cannot, as edits of the file's text, so your comments stay; it is refused while the file does not parse or does not hold an object.
A change to the file counts from the next session you start, and for the sessions running at quit, from the next launch, or on macOS the next window opened from the Dock; a change to `prStatus` counts at once.
A `settings.json` you were sent sets flags on every session you start, so read it before you use it.
A mistake in the file is named in Settings, and a file that does not parse keeps the settings it last read until it does.

## Install a build

The app runs the real `claude` CLI, so **install and sign in to Claude Code first** — without it every session opens on "command not found".

Builds are not published anywhere: ask for the file.
The version you are running is in the window title, which is what to quote in a bug report.

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

**Linux** (Debian 12 or newer, and Ubuntu 22.04 or newer, under WSL too):

```bash
sudo apt install ./claude-ui-<version>-amd64.deb
```

Use `apt`, not `dpkg -i`: apt pulls in the dependencies the app needs, and `dpkg` fails without them.
The same command installs a newer version over an older one, keeping your pins, groups and notes.

Under WSL, also install `wl-clipboard` (`sudo apt install wl-clipboard`): claude can then read a pasted screenshot without going through Windows' PowerShell, which can take seconds.
A `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp` file copied in Explorer pastes into claude as its path, which claude attaches; with wl-clipboard a plain Copy does this too, usually after about a second to read it from Windows, and Copy as path (Ctrl+Shift+C on recent Windows 11) does it at once.

For a non-Debian distribution there is an `.AppImage`: `chmod +x` it and run it.
It has no install or upgrade step, so updating means replacing the file yourself.

## Run from source

- WSL 2 with WSLg.
  The app and `claude` both run inside the Linux distribution.
- Node, managed by [mise](https://mise.jdx.dev).
  Run `mise install` once.
- A C toolchain for the native terminal module: `sudo apt-get install build-essential`.

```bash
mise install
npm install
npm run rebuild   # build node-pty against Electron's ABI
npm start
```

`npm start` builds and launches the app.
It runs with `--no-sandbox`, which WSL requires.

`npm test` runs the unit tests, and `npm run test:renderer` checks the window itself in a headless browser, which `npx playwright install --only-shell chromium` fetches the first time.
Which of them a change needs is in [the architecture notes](docs/architecture.md#which-checks-a-change-needs).

To produce installable builds: `npm run dist:linux`, and `npm run dist:mac` on a Mac.
Artifacts land in `release/`.
Tagging a version runs CI's checks on it, then builds both on CI and publishes them as a release.

## Project layout

- `src/main` — Electron main process: window and IPC.
- `src/main/sessions.ts` — reads and summarizes `~/.claude/projects`.
- `src/preload` — the bridge the renderer uses to reach the main process.
- `src/renderer` — the window UI.
- `src/renderer/state` — the store the window's surfaces share, and what more than one of them reads from it.
- `src/renderer/panels` — the layout tree and the panel types: `panels/types/sessions` (the sidebar), `panels/types/claude` (the terminal area), and the others.
- `src/shared` — types and pure helpers shared by both sides, and main's rules the window's checks answer with.
- `test/` — the tests: unit tests in `test/unit/`, mirroring `src/`, the rules every comment and doc keeps in `test/text/`, and the window's checks in `test/renderer/`, filed by the panel they check.
- `docs/` — architecture and design notes.

## License

MIT — see [LICENSE](LICENSE).
