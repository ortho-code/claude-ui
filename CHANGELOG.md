# Changelog

What changed in each release, for people running a build rather than the source. The version you are
running is in the window title.

## Unreleased

## 0.2.0 — 2026-08-28

**Upgrading on macOS, this version only:** delete the old Claude UI from Applications before installing this one. The app's internal identifier changed, so macOS treats this as a new app rather than a replacement, and you would otherwise end up with two. Your sessions, pins and groups are not affected. Linux upgrades normally, with the same `apt install` command as before.

- Closing a tab works on macOS. The close button was being swallowed by the drag-to-reorder handling, which only misbehaved there.
- Starting or resuming a session shows that it is starting, instead of a black pane for the couple of seconds claude takes to appear.
- A session no longer stays marked as waiting for you after you answer a permission prompt. It goes back to busy as soon as work resumes, rather than at the end of the turn.
- The app icon shows correctly on Linux, in the Start menu and the taskbar.
- Your pins, groups, notes and open tabs are kept safe across an update: installing a different version keeps a copy of them first, and an older version can no longer discard settings a newer one wrote.

## 0.1.0 — 2026-08-27

First packaged release. Until now the app had to be run from source; there are now installable builds
for macOS (Apple Silicon) and Linux. See the README for how to install one, including the extra step
macOS needs on first launch.

What the app does, for anyone seeing it for the first time:

- Lists your `~/.claude` sessions grouped by project, with pinning, archiving, notes and custom
  groups, refreshed as transcripts change on disk.
- Runs several sessions at once in tabs, each an embedded terminal running the real `claude` CLI,
  with its approval prompts and permission modes intact.
- Shows a per-session cue for busy, idle and waiting-for-you, so a session that needs an answer is
  visible without opening it.
- Starts new sessions, forks an existing one, and creates sessions in a fresh git worktree.
- Restores your open tabs on launch without starting them; a tab starts when you click it, and can be
  stopped again while keeping its place.
