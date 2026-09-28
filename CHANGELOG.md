# Changelog

What changed in each release, for people running a build rather than the source. The version you are running is in the window title.

Entries are grouped as Added, Changed and Fixed, following [Keep a Changelog](https://keepachangelog.com). Anything you have to DO when upgrading is in [UPGRADING.md](UPGRADING.md) instead, so this file stays a list of what changed.

## Unreleased

### Added

- A filter for sessions whose folder is gone, next to the other filter pills — the set to clean up, or to put folders back for.
- A config folder for the files you may edit or share, `config/` inside the app's data directory, holding the layout file `layouts/default.json` and the scripts it points at; the app reads and watches it and never writes to it, and Settings shows where it is with an Open button.
- A layout that arranges the whole window, from that file: rows and columns of panels with the sidebar and the terminal among them, sized in shares or pixels and resized from dividers, where a double-click puts back the file's sizes. A mistake in the file is named where it is instead of dropped, and no file can leave you without the terminal; without a file, the window is as it was.
- A `command` panel type: a command line or a script, run in the active tab's folder (or the selected project's) and shown as plain text, run again when you switch project or tab or press Refresh. A `cwd` option runs it in a fixed folder instead, whatever is selected, or in a subfolder of the project.
- A `terminal` panel type: a plain shell in the folder the panel first showed for. It stays there when you switch tab or project, the header says where it is, and the button restarts it in the current folder. After the shell exits, any key starts a new one. It takes the same `cwd`; with a fixed one it starts there and has no restart button.
- Several panels in one group, switched from a strip of icons whose dot says a command failed or a session is waiting for you; a panel out of sight keeps what it was doing and runs again only once shown.
- Folding a group of panels to its strip of icons, from a chevron on the divider beside it or by clicking the icon of the panel on show.
- Clicking a group's name in the tab bar takes the session list to that group, as a project's name already does; either one flashes the heading it lands on.
- A new, empty group from a project's options; a group used to need a session to start from.
- A log file, one per launch and day, to send along when something goes wrong: Settings shows its folder with an Open button, and the log of a launch that crashed is kept for longer.

### Changed

- A session stopped before you had sent it anything comes back as the same session when you start it again, keeping its pin, note and group, instead of returning as a new one.
- The filter button is a funnel instead of a magnifier: closing its panel keeps the filter on, which is not what a search box does.
- Icons in the sidebar and tab bar share one line weight.
- Closing the filter panel while a filter is on leaves a row showing what is on — the search text, each filter, the date range — each with its own ×, above the count and Clear; press the row to open the panel again.
- Every scrollbar is the thin dark one the session list and the terminal already had, including the project switcher, the live strip and panels, instead of the system's light one.
- A project whose folder is gone is marked in the project switcher, on its heading and in the tab bar, with a crossed-out folder and a muted name, instead of only in its sessions' rows.
- Project names in the tab bar are in full text colour, as their headings in the session list are.
- A tab whose session's folder is gone is dimmed like its row, with the reason on hover, instead of looking like a tab you can resume.
- Making a group from a session's options takes the list to the new group at the top of its project, instead of leaving the session to move out of sight.

### Fixed

- A session you `/clear` stays in the group it was in, instead of the tab dropping out of its section.
- Compacting a session shows it as busy while it runs and idle when it finishes, instead of leaving the dot on whatever it said before.
- Entering or leaving a worktree, and gaining a sibling, show up in the session list when they happen instead of waiting for some unrelated change.
- Stopping a session now ends it. It was asked once, with a signal it was free to ignore, and the session could keep running while the app showed it as stopped — including the sessions left behind when you quit the app.
- Switching model with `/model` updates the model shown in the session list straight away, instead of only once that model had answered something.
- The live strip keeps still. It follows your tabs now, so a row only moves when you drag, open, close or regroup a tab — rows used to swap places whenever one of them wrote a message. Pinned sessions no longer float to the top of it.
- Closing a live session's tab takes it out of the live strip at once, instead of a moment later.
- The tab bar puts projects in the order you set, like the session list and the live strip. It used to order them by whichever project you happened to open a tab for first, which moved on its own as tabs came and went.
- A session whose folder no longer exists says so instead of quietly starting in your home directory and moving itself there in the list. Such a session is dimmed and can't be opened or forked, and a project whose folder is gone can't start new sessions — with the reason on hover. Pinning, notes, archiving and deleting still work, and a session comes back to life if you put its folder back (for a worktree, recreate it at the same path).
- Screen readers announce the filter button by name; it had none.
- The filter count's total is what you are filtering — the selected project's sessions, and in the archived view its archived ones — instead of every session in every project, archived included.
- A group's icon in the tab bar is muted again, as it is in the session list.
- A menu opened near the bottom of the window opens upward, instead of running off the edge.

## 0.3.0 — 2026-08-29

### Added

- A filter for sessions carrying a note.
- A settings screen, behind the gear in the sidebar header. It holds default launch flags for now: set `--allowedTools Grep,Glob` once instead of typing it per session. Flags the app sets for itself are refused with a reason, and a change applies to sessions started from then on.
- Mute or stop a session from the live strip, without leaving the project you are looking at.

### Changed

- The app reopens the way you left it: the window's size and position, and the sidebar's search, filters, date range, folds, width and scroll offset.
- The filter panel reopens as you left it, with whatever filter was on still applied.
- Folding a project or group while a filter is on lasts as long as the filter and leaves your usual folds alone underneath.
- A tab's button takes two presses: the first stops the session and leaves the tab cold and resumable, the second removes the tab. A cold tab still goes in one press.
- The strip is gone entirely when nothing is running, rather than saying "All clear" with a caret that could not open. It comes back the way you left it.
- The live strip lists what is running, wherever it is running, rather than only what is nudging. Marking a dot read no longer removes its row, its label counts what actually wants you ("2 of 5 need you"), and a session in a group carries that group's name.
- The strip follows the sidebar's order — your project order, pins floated — instead of reshuffling itself on every status change.
- A session with a `claude` behind it is called LIVE, not running — "running" read as a state like busy rather than as the difference between a session and a tab.
- A session that has just started, before it reports anything, shows as a quiet ring in the strip instead of an empty gap.
- The button that acts in a dialog — Save, or Delete — is filled rather than outlined, so it is the one your eye lands on.
- Status dots read as states: "Busy", "Idle", "Waiting for you", and "Not running" for a hollow one, which used to say "closed".

### Fixed

- Deleting a session while its tab was still starting left a `claude` running with nothing pointing at it.
- Projects in the switcher stayed marked when nothing under them wanted you.
- The window no longer drifts down and to the right by one title bar on each launch, and it can no longer be resized down to nothing.
- The pin, the toast close and the notification close grew by two pixels when hovered, while every other icon button held still.

## 0.2.0 — 2026-08-28

Upgrading on macOS needs one manual step this version only — see [UPGRADING.md](UPGRADING.md).

### Changed

- Starting or resuming a session shows that it is starting, instead of a black pane for the couple of seconds claude takes to appear.
- Your pins, groups, notes and open tabs are kept safe across an update: installing a different version keeps a copy of them first, and an older version can no longer discard settings a newer one wrote.

### Fixed

- Closing a tab works on macOS. The close button was being swallowed by the drag-to-reorder handling, which only misbehaved there.
- A session no longer stays marked as waiting for you after you answer a permission prompt. It goes back to busy as soon as work resumes, rather than at the end of the turn.
- The app icon shows correctly on Linux, in the Start menu and the taskbar.

## 0.1.0 — 2026-08-27

First packaged release.
Until now the app had to be run from source; there are now installable builds for macOS (Apple Silicon) and Linux.
See the README for how to install one, including the extra step macOS needs on first launch.

### Added

- Lists your `~/.claude` sessions grouped by project, with pinning, archiving, notes and custom groups, refreshed as transcripts change on disk.
- Runs several sessions at once in tabs, each an embedded terminal running the real `claude` CLI, with its approval prompts and permission modes intact.
- Shows a per-session cue for busy, idle and waiting-for-you, so a session that needs an answer is visible without opening it.
- Starts new sessions, forks an existing one, and creates sessions in a fresh git worktree.
- Restores your open tabs on launch without starting them; a tab starts when you click it, and can be stopped again while keeping its place.
