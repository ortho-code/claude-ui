# claude-ui

A desktop app for running and tracking several Claude Code sessions from one window.

## Why

The existing session managers each miss part of what you want.
Claude Code Desktop, Pane, ccmanager, and Claude Squad all put every session in its own git worktree, and none of them combine:

- a session list read straight from `~/.claude`,
- pinning and grouping,
- a full `claude` CLI running in an embedded terminal, with its real approval prompts,
- a per-session cue when a session is waiting for you or ready for your next prompt.

claude-ui aims for that combination, and runs sessions in the project directory itself instead of forcing a worktree per session.
What it holds to, and what a change to it is checked against, is in [docs/principles.md](docs/principles.md).

## What it does

- **A session list read from `~/.claude`**, grouped by project and into groups of your own, with search, filters, notes and pins, and a Recent view of everything by last activity ([Sessions](docs/guide/sessions.md)).
- **Tabs with the real `claude` CLI** in an embedded terminal, several sessions running at once, restored at the next launch ([Tabs and the terminal](docs/guide/sessions.md#tabs-and-the-terminal)).
- **A status dot per session**: busy, ready, waiting for you or working in the background, and a mark when a session needs you, such as a PR of yours merged or a reminder you set ([Status and what needs you](docs/guide/status.md)).
- **Forks and worktrees**, started from the app and followed when a session moves into one ([Forks and worktrees](docs/guide/sessions.md#forks-and-worktrees)).
- **The PRs a session links**, coloured by what GitHub says of them ([Pull requests](docs/guide/sessions.md#pull-requests)).
- **Finishing, setting aside and a review** to clear out what is done or can wait ([Finishing, setting aside and the review](docs/guide/sessions.md#finishing-setting-aside-and-the-review)).
- **A history of each session**, laid out as claude shows it, with pins ([The history](docs/guide/sessions.md#the-history)).
- **A layout of your own**: panels beside the sidebar and the terminal, such as a command's output, shells, or a panel type of your own ([Layout and panels](docs/guide/layout.md)).
- **Settings** in a `settings.json` you can edit by hand or in the app ([Settings](docs/guide/settings.md)).

The whole guide is in [docs/guide](docs/guide/README.md).

## Install a build

The app runs the real `claude` CLI, so **install and sign in to Claude Code first** — without it every session opens on "command not found".

Builds are on the repository's [Releases](https://github.com/ortho-code/claude-ui/releases) page.
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

## Contributing

Running it from source, and how the code is laid out, is in [CONTRIBUTING.md](CONTRIBUTING.md).
What changed in each release is in [CHANGELOG.md](CHANGELOG.md), and what a version needs you to do in [UPGRADING.md](UPGRADING.md).

## License

MIT — see [LICENSE](LICENSE).
