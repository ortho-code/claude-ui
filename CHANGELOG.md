# Changelog

What changed in each release, for people running a build rather than the source. The version you are
running is in the window title.

## Unreleased

- Closing a tab works on macOS. The close button was being swallowed by the drag-to-reorder handling,
  which only misbehaved there.
- The app icon shows correctly on Linux, in the Start menu and the taskbar.

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
