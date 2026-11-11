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
A group with several panels switches between them from a strip of icons on its edge: hovering an icon names the panel, and a dot on it says a run failed, or a session is waiting for you or needs you.
Clicking the icon of the panel on show folds a group that can fold, and clicking any icon of a folded group unfolds it on that panel.

Every id, of a node or a panel, is unique in the file and uses lowercase letters, digits, hyphens and underscores.
A panel needs an `id` and a `type`; `title`, `icon`, `view` and `hidden` are optional, and whatever the type itself takes goes under `options`.
`icon` picks its icon by name: `git`, `list`, `tree`, `check`, `eye`, `bug`, `book`, `clock`, `server`, `play`, `search`, `bell`, `terminal`, `command`, `sessions`, `claude` or `alert`.
`view` picks, by id, the view a panel shows until another is picked in its header, for a type that offers several, such as a list of files flat or as a tree; an edit of it shows from the panel's next run, and a pick in the header is kept on this machine instead.
The session list offers `grouped` and `recent`, switched under its header rather than in one, and shows an edit of its `view` at once, since it has no run, unless a pick of its own is kept on this machine.
A panel that cannot run wears `alert` whatever it names, so a broken one stands out on a strip of icons too.

## The panel types

- `sessions` is the sidebar and `claude` is the terminal area with its tabs.
  Each belongs in the file exactly once: one left out is added back, and a second copy says where the first one is, so no file can leave you without the terminal.
- `command` runs something and shows what it printed, given one of two ways in its `options`: `command`, a command line run by your login shell as you typed it, or `script`, the path to an executable.
  `cwd` picks the folder it runs in, `interval` how often it runs again on its own, and `watch` whether it runs again when that folder's git working tree changes.
- `terminal` holds plain shells, the same login shell your sessions run in, as tabs in its header.
  `cwd` picks the folder they start in, and `scope` whether its tabs are the selected project's (`project`) or the same in every project (`global`).
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

## Panels and the session list

- Any panel, the sidebar and the terminal included, fills the window from a button in its header, and the same button puts the layout back as it was.
- Show in list, a project's or group's name in the tab bar, and a click on the tab on show while you are typing in it bring the session list into view when it is folded, behind another panel or under another panel's full screen.
- A panel follows its tab's session into the worktree claude is changing files in, by path, after a `cd` or by claude's own worktree tools, and names the folder it looks in beside its title.

## Panel types of your own

A folder under `panel-types/` in the config folder is a panel type, named after the folder, so a type is shared by copying its folder.
It holds a `panel.json` saying what the type is, and a script that prints a list, which the app draws: rows with links, sections that fold, a count on the panel's icon kept current on an interval, and buttons that start a Claude session with a prompt you see, and can change, before it starts.
A row that started a session then shows that session's status and leads back to it.
A row that names a session shows its note mark too while it has a note, as the session list does, so a note on why it waits is a hover away.

[Panel types of your own](../panel-types.md) is the whole of it: what goes in the folder, what the script is given and prints, what the app does with it, and an example type to copy.

A type you were sent runs as you, the way a script in `scripts/` does, so read it before you drop it in; everything a panel does beyond running its script, such as opening a link or starting a session, is something you press.
