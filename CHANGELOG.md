# Changelog

What changed in each release, for people running a build rather than the source. The version you are running is in the window title.

## Unreleased

## 0.3.0 — 2026-08-29

- A settings screen, behind the gear in the sidebar header, holding one setting for now: flags added to every session the app starts. So `--allowedTools Grep,Glob` is set once instead of typed per session. Quoted values are handled properly, and the flags the app sets for itself — the ones deciding which session a tab resumes, or where its status hooks come from — are refused with a reason rather than allowed to break a session in a way that looks like the app is broken. Flags apply to sessions started from then on; anything already running keeps what it started with.
- A session in the live strip can be muted where it is listed: click its dot, exactly as you would in the sidebar or on its tab. Marking one read anywhere else means going to where that session lives, which costs you the project you were looking at.
- And stopped from the same row. The strip lists what has a `claude` behind it, which is exactly the set of things that can be stopped, so the square beside a session ends it without taking you out of the project you are in. Like the tab's own button, it is inert while a session is still on its way in or out.
- The status dots say what a session is doing rather than what the app calls it internally: "Busy", "Idle", "Waiting for you", and "Not running" for a hollow one, which used to say "closed".
- The button that acts in a dialog — Save, or Delete — is filled now, so it is the one your eye lands on. It used to be outlined in the accent colour, which is the same treatment every button gets on hover, so Save looked permanently hovered.
- The pin, the toast close and the notification close grew by two pixels when hovered, while every other icon button held still. All of them share one rule now.
- The window no longer drifts down and to the right by one title bar each time you launch it.
- Its minimum size is enforced, so it cannot be resized down to nothing.
- A session that has just started, before it reports anything, shows as a quiet ring in the live strip instead of an empty gap. Projects in the switcher stay unmarked until something under them actually wants you.
- The attention strip at the bottom of the sidebar now lists what is RUNNING, wherever it is running, rather than only what is nudging: marking a dot read no longer deletes its row, and a live session in a project you are not looking at is reachable from somewhere at last. Its label counts what actually wants you ("2 of 5 need you"), rows you have read stay dimmed, and a session in a group carries that group's name.
- A session with a `claude` behind it is called LIVE now, not running — "running" read as a state the session was in, like busy, rather than as the difference between a session and a tab. The filter pill says so too.
- The strip keeps its order now. It used to sort itself most-urgent-first, so every status change reshuffled it; it follows the sidebar's order instead — your project order, pins floated.
- The strip is gone entirely when nothing is running, rather than sitting there saying "All clear" with a caret that could not open anything. It comes back — the way you left it, open or closed — as soon as something starts.
- A tab's button now takes two presses: the first stops the session and leaves the tab cold and resumable, the second removes the tab. The mark says which press you are on — a stop square, then a cross — and it is inert while a session is arriving or leaving, so a tab cannot be acted on before its process is there or while it is still going away. A cold tab still goes in one press, and stopping has left the session's menu for the tab it belongs to.
- Deleting a session while its tab was still starting left a `claude` running with nothing pointing at it. It is now shut down as soon as it reports for duty.
- A filter for sessions carrying a note, alongside the pinned, open, running, worktree, siblings and archived ones.
- The app reopens the way you left it: the window's size and position, and the sidebar's search, filters, date range, folded-away projects and groups, width and scroll offset. A window whose screen is gone opens on one that exists, at the size you had.
- The filter panel reopens as you left it, open or closed, with whatever filter was on still applied and the filter icon accented to say so.
- Folding a project or group while a filter is on is its own thing: it is a way through the results, so it lasts as long as the filter, leaves your usual folds alone underneath, and comes back with the filter after a restart.

## 0.2.0 — 2026-08-28

**Upgrading on macOS, this version only:** delete the old Claude UI from Applications before installing this one.
The app's internal identifier changed, so macOS treats this as a new app rather than a replacement, and you would otherwise end up with two.
Your sessions, pins and groups are not affected.
Linux upgrades normally, with the same `apt install` command as before.

- Closing a tab works on macOS. The close button was being swallowed by the drag-to-reorder handling, which only misbehaved there.
- Starting or resuming a session shows that it is starting, instead of a black pane for the couple of seconds claude takes to appear.
- A session no longer stays marked as waiting for you after you answer a permission prompt. It goes back to busy as soon as work resumes, rather than at the end of the turn.
- The app icon shows correctly on Linux, in the Start menu and the taskbar.
- Your pins, groups, notes and open tabs are kept safe across an update: installing a different version keeps a copy of them first, and an older version can no longer discard settings a newer one wrote.

## 0.1.0 — 2026-08-27

First packaged release.
Until now the app had to be run from source; there are now installable builds for macOS (Apple Silicon) and Linux.
See the README for how to install one, including the extra step macOS needs on first launch.

What the app does, for anyone seeing it for the first time:

- Lists your `~/.claude` sessions grouped by project, with pinning, archiving, notes and custom groups, refreshed as transcripts change on disk.
- Runs several sessions at once in tabs, each an embedded terminal running the real `claude` CLI, with its approval prompts and permission modes intact.
- Shows a per-session cue for busy, idle and waiting-for-you, so a session that needs an answer is visible without opening it.
- Starts new sessions, forks an existing one, and creates sessions in a fresh git worktree.
- Restores your open tabs on launch without starting them; a tab starts when you click it, and can be stopped again while keeping its place.
