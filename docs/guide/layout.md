# Layout and panels


A layout file arranges the window: rows and columns of panel groups, with the sidebar and the terminal area as two of the panels, each drawn by modules of its own like any other type.

## The config folder

The layout lives in the app's config folder, which Settings shows with an Open button:

- Linux: `~/.config/claude-ui/config/`
- macOS: `~/Library/Application Support/claude-ui/config/`

Write `layouts/default.json` there, and the app picks it up as you save.
Every file in the folder is JSON that may also carry comments (`//` and `/* */`) and trailing commas.
Without a file — or after you delete or rename yours — the window is the default layout below, so there is always a way back to one that works.
The app writes `settings.json` at a launch that finds none, when you save in Settings, and once at a launch to move settings kept elsewhere before into it, and the files whose names end in `.local.json`, which hold where you left a layout on this machine, such as the sizes you drag to, and win over the file of yours beside them.
Every other file is yours and the app never writes it, so it is yours to edit, version, or hand to a colleague; a `.local.json` holds nothing secret and may go along, with this machine's sizes in it, and a folder you keep in git can leave them out with `*.local.json` in its `.gitignore`.

## The layout file

The default layout, as a starting point to copy:

```json
{
  "version": 2,
  "root": { "id": "window", "columns": [
    { "id": "sidebar", "size": "320px", "min": 220, "panels": [{ "id": "sessions", "type": "sessions" }] },
    { "id": "claude", "panels": [{ "id": "cli", "type": "claude" }] },
    { "id": "editor", "size": 0.67, "panels": [{ "id": "files", "type": "editor" }] }
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
A group with several panels switches between them from a strip of icons on its edge: hovering an icon names the panel, and a dot on it says a run failed, or a session is waiting for you or needs you.
Clicking the icon of the panel on show folds a group that can fold, and clicking any icon of a folded group unfolds it on that panel.

Every id, of a node or a panel, is unique in the file and uses lowercase letters, digits, hyphens and underscores.
A panel needs an `id` and a `type`; `title`, `icon`, `view` and `hidden` are optional, and whatever the type itself takes goes under `options`.
`icon` picks its icon by name: `git`, `diff`, `file`, `list`, `tree`, `check`, `eye`, `bug`, `book`, `clock`, `server`, `play`, `search`, `bell`, `terminal`, `command`, `sessions`, `claude` or `alert`.
`view` picks, by id, the view a panel shows until another is picked in its header, for a type that offers several, such as a list of files flat or as a tree; an edit of it shows from the panel's next run, and a pick in the header is kept on this machine instead.
The session list offers `grouped` and `recent`, switched under its header rather than in one, and shows an edit of its `view` at once, since it has no run, unless a pick of its own is kept on this machine.
A panel that cannot run wears `alert` whatever it names, so a broken one stands out on a strip of icons too.

## The panel types

- `sessions` is the sidebar and `claude` is the terminal area with its tabs.
  Each belongs in the file exactly once: one left out is added back, and a second copy says where the first one is, so no file can leave you without the terminal.
- `editor` is where the Editor docks beside the terminal, taking no room while it is not docked or nothing is open in it; see [The Editor](#the-editor) below.
  It belongs in the file at most once: one left out is added as a column right after the one holding the terminal area, and `"hidden": true` on its entry means it never docks, opening only as a drawer.
- `command` runs something and shows what it printed, given one of two ways in its `options`: `command`, a command line run by your login shell as you typed it, or `script`, the path to an executable.
  `cwd` picks the folder it runs in, `interval` how often it runs again on its own, and `watch` whether it runs again when that folder's git working tree changes.
- `terminal` holds plain shells, the same login shell your sessions run in, as tabs in its header.
  `cwd` picks the folder they start in, and `scope` whether its tabs are the selected project's (`project`) or the same in every project (`global`).
- `explorer` shows what changed in the checkout it looks in, which it finds as a `command` panel finds its folder, and takes a `cwd` the same way; see [The Explorer](#the-explorer) below.
- `session-view` shows a view of your sessions as the session list's own rows, named by `show`; `"show": "now"` is Now, see [Now](sessions.md#now).
  Place as many as you like: `{ "id": "now", "type": "session-view", "options": { "show": "now" } }`.
- A folder under `panel-types/` in the config folder is a type of your own, named after the folder; see [Panel types of your own](#panel-types-of-your-own) below.

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

The command runs where the active tab's session works, or in the selected project's root when no tab is open, and runs again when you switch project or tab or press Refresh.
Where a session works is the checkout, the main one or a worktree, holding the file claude last changed with its file tools, such as an edit, which it may have reached by path or with a `cd` as well as by claude's own worktree tools; a file git ignores, such as notes kept beside the code, does not count, and claude entering or leaving a worktree after that change puts it back in the folder the session runs in, as does having changed nothing yet.
The panel's header names that folder beside its title: the project's folder, muted, for the main checkout, or the worktree's name with the worktree mark, and the whole path when you point at it.
A checkout picked from the list the session's worktree badge opens, or from Worktrees in its options, holds the panels there instead while that session is on show, with a star beside its name in the header, until you pick Follow the session in that list; while the checkout is gone, they follow the session.
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
| `CLAUDE_UI_PROJECT_ROOT` | the repo root of the active tab's session, else of the selected project; empty without either |
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
- A relative path is under the folder the panel would run in without one, so `"cwd": "packages/api"` follows the project into that folder.

```json
{ "id": "notes", "type": "command", "icon": "git", "options": { "command": "git status --short", "cwd": "~/notes" } }
```

The variables tell the panel where it runs: `CLAUDE_UI_CWD` is that folder, and the project and session are the ones selected when it ran or started, except for a shell filed under a project of its own, as above.

A mistake in the file — an unknown type, a missing id, a size it cannot read, an option the type does not have, a script that is not there or not executable — is named in the place of the thing that is wrong, and a file that does not parse leaves the last good layout up and says what is wrong and at which line and column.
A panel's options are checked by the panel itself, when it appears and before each run, so a missing script is named a moment after the rest.

## The Explorer

An `explorer` panel lists the files that changed in the checkout it looks in, and in the session's other checkouts, beside the session that is changing them:

```json
{ "id": "changes", "type": "explorer" }
```

It looks where a `command` panel would run, follows the session into a worktree the same way, and takes a `cwd` the same way.
Each checkout is a row of its own, with its branch where that is not the folder's name and how many files changed there, its files under it along a line, as a group's sessions are in the session list: the one it looks in first, then the other checkouts the session changed files in, then the main checkout when the session changed nothing there, folded, so others' changes there stay out of the way until you open it.
Repositories inside the folder it looks in, up to three folders down, are rows of their own too, named by their path from it and folded while nothing changed there; a folder that is no repository itself, such as a WordPress install, shows the repositories inside it.
With more than one checkout, the layers button at the end of the row over the list jumps to one of them.
The double chevron at the end of that row collapses every checkout and, in the tree, every folder, and expands them all again, as the session list's does.
In the tree, `"folders": "combined"` puts a chain of folders that each hold only the next on one row, `src/app/http`, where the default, `separate`, gives each folder a row of its own, as a `changes` panel's option does.
Once you scroll past a checkout's row, a line over the list names the checkout you are in and, in the tree, the folders that hold the top row, `demo › src / app / http`, and a press on a part scrolls back to its row; a press on a `…` lists the folders it stands for.
In the tree, the checkout's name takes at most 40% of that line; when the line is still too long, the folders nearest the checkout give way to `…`, and then the checkout's name is cut further, so the folder you are in stays whole.
The menu over its list picks what it lists, and is kept for the panel:

- **Since branched**: everything the branch did since it left its base, committed or not.
- **Unpushed**: what the next push would send, plus what is not committed yet.
- **Uncommitted**: only what is not committed.

Beside the first two, the menu says how many commits each covers.
Since branched measures from a base branch: the default branch of the remote named `upstream`, or else of `origin`, which the row over the list names, marked as guessed, with how many commits on it the branch does not have yet.
A checkout can answer a question of its own: the ⋮ at the end of its row names its branch and base, and picks one of the three for that checkout alone, with how many commits each covers there, or **Follow the panel** to follow the menu over the list again.
A checkout set on its own says its question on its row, and the menu over the list then reads **Mixed**; a pick there sets every checkout again.
With more than one checkout, the row over the list names no base and its menu counts no commits, since each checkout's ⋮ says both for itself.
**Change the base…** in a checkout's ⋮ while it shows Since branched, or a press on the base the row over the list names, picks what Since branched measures from: any other branch, local or remote, searched by name, each with how many commits it would count.
A press selects a branch and **Save** keeps it; a double click on a branch does both, and Enter saves what is selected.
It is kept for the branch the checkout has out; with **Use for the whole project** ticked under the list, it is kept for every checkout of the repository without one of its own, and this branch's own pick is dropped, so this checkout follows it too.
**Default**, the first row, keeps no base of its own, and says beside it what is then followed: the project's base where one is kept that still exists and the box is unticked, or else the guess.
The box over the search says what the checkout was last measured from and why, and what Save will change, with **Undo**; a press on a name there shows that branch in the list.
A checkout measured from a base its branch keeps says `from <branch>` on its row while it shows Since branched.
Nothing is fetched for it, so it is measured as your last fetch left the remote branches.
Each file shows its letter (`M` changed, `A` added, `D` removed, `R` renamed, `U` not tracked yet), its name after its folder, and the lines it adds and removes; a renamed file's tooltip says where it came from.
The switch in its header shows the files as a flat list or as a tree of their folders, where a press on a folder folds it.
A press on a file opens its diff in the [Editor](#the-editor), and the list marks the file the Editor shows.
The list reads again when a switch of tab or project moves where it looks, within a minute of a file in the checkout changing, and when the session on show starts or finishes a turn.
Untracked files past the first 500 are counted under the list rather than listed.

## The Editor

Files open in the Editor, as a drawer over the terminal area, the one the history opens in: claude stays in view beside it, dimmed, and Esc, a click on claude, or closing the last file, closes it.
Over a tab with no claude, one you have not resumed, the Editor takes the whole pane, as the history does there.
**Dock** in its head puts it beside the terminal instead, so you can read while the session goes on working, and **Undock** puts it back; the app remembers which.
Docked, it takes no room while nothing is open in it, and comes back at the size you last gave it when a file opens; in the default layout it first takes two-thirds of what it shares with the terminal.
Opening a file puts the Editor in sight, docked or in the drawer over the terminal: the Editor, or the terminal, comes in front of the other panels of its group, its group unfolds, and the layout comes back if another panel fills the window.
The **×** at the end of its head closes all its files at once, docked or not, on both sides while it is split.
The Editor and the history take turns in the drawer; with the Editor docked, the history opens over the terminal and the file stays in view.
With the history docked beside claude, a file's drawer slides in over both, from the right.
With both open, a rail on the drawer's left edge switches between them: History, and Files with how many are open; a click on the lit one closes the drawer, a click on the other shows that one, and the history comes back where it was when the files took its place.
Each session tab has its own files in it; switching tabs switches them, and closes the drawer.

A press on a file opens it as a preview, its name in italics, which the next file you open takes the place of; a double click, on the file or on its tab, or Pin in the tab's menu, keeps it, so the next one opens beside it.
The tab's menu also copies the file's path, moves it to the other side, and closes the other tabs, this one, or all of them on its side; its cross closes it too.

**Move to the other side** in a tab's menu splits the Editor in two, with that file on the right; once it is split, drag a tab from one side's row to the other's to move it there.
A file has one tab in the Editor, on one side.
A file you open goes to the side you pressed last, whose tab on show has the coloured edge, unless it is open already, which shows it on its own side.
The divider between the two sides drags their widths, and a double click makes them even; each session tab keeps its own split while the app runs.
Closing the last file on a side ends the split, and the other side takes the whole width.
In the history, a press on the file a Read, Edit or Write names opens it in the Editor as a preview, which Pin keeps.
So does a press on a file path claude prints in a session tab's terminal, underlined when you point at it if the file is there; a line number after it, as in `src/app.ts:42`, brings that line into sight.
A file outside every repository, such as a scratchpad file or a plan, or one its repository ignores, shows what changed since the session first changed it, as its header says; where claude did not record the text from before, a line says so and the file shows as it is, as does a file the session only read; a file no longer on disk, such as a scratchpad file a restart emptied, says so.
The Editor only reads for now, and every file says "Read only".

A file is shown whole, with its changes marked where they are.
The diff's header names the file on its first row; on the second, its menu picks Fit, which draws the two sides next to each other once the Editor, or the side the file is on, is 600px wide and one above the other below that, or Split or Unified whatever the width.
Beside it, **Hide whitespace** leaves out changes that only touch whitespace, and **Changes only** folds the unchanged lines between changes, five or more of them: press a fold to show them all, or, on a fold of more than twenty lines, its `↑ 20` and `↓ 20` to show twenty more beside the change below or above it.
When either leaves nothing to show, the Editor says why, such as a file renamed and nothing else, or, in a repository, one whose mode alone changed, with a button that switches it off: **Show the whole file** or **Show whitespace changes**, the latter only where the file did change.
These picks are kept for the Editor.
The code is coloured by its language: PHP, TypeScript, JavaScript, JSON (with JSONC and JSON5), HTML, SCSS, CSS, Markdown, YAML, shell scripts, Twig, XML, SQL, a file named `Dockerfile`, INI, TOML, Python, PowerShell, Go and Rust; anything else is plain text.
The words that changed inside a line are marked, a lockfile or generated file is folded to one line until you press it, and the map at the right edge has a mark for each change.
`j` and `k` in the diff, or the arrows in its header, step from change to change and on into the next file of the list it was opened from.
An open file is read again within a minute of a file in its checkout changing.

## Panels and the session list

- Any panel, the sidebar and the terminal included, fills the window from a button in its header, and the same button puts the layout back as it was.
- Show in list, a project's or group's name in the tab bar, and a click on the tab on show while you are typing in it bring the session list into view when it is folded, behind another panel or under another panel's full screen.
- A panel follows its tab's session into the worktree claude is changing files in, by path, after a `cd` or by claude's own worktree tools, and names the folder it looks in beside its title.
- A panel with Refresh says beside it how long ago what it shows came from a run, "3 min ago", with the moment in full when you point at it, and at Refresh too.
  A list whose last run failed keeps the time of the list still on show, and its tooltip says when the run failed; a command panel shows its last run's output, failed or not, so the time is that run's.
  A run under way leaves the last time, and a panel that cannot run, or has nowhere to, shows none.
  In a header too narrow for the time and the whole title, the time goes first.

## Panel types of your own

A folder under `panel-types/` in the config folder is a panel type, named after the folder, so a type is shared by copying its folder.
It holds a `panel.json` saying what the type is, and a script that prints a list, which the app draws: rows with links, sections that fold, a count on the panel's icon kept current on an interval, and buttons that start a Claude session with a prompt you see, and can change, before it starts.
A row that started a session then shows that session's status and leads back to it.
A row that names a session shows its note mark too while it has a note, as the session list does, so a note on why it waits is a hover away.

[Panel types of your own](../panel-types.md) is the whole of it: what goes in the folder, what the script is given and prints, what the app does with it, and an example type to copy.

A type you were sent runs as you, the way a script in `scripts/` does, so read it before you drop it in; everything a panel does beyond running its script, such as opening a link or starting a session, is something you press.
