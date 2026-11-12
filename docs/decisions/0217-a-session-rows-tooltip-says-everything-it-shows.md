# A session row's tooltip says everything it shows

- **Date:** 2026-11-12
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)

## Decision

Hovering anywhere on a session row shows one tooltip with what the row shows, and more than its line has room for: the session's name, why it cannot start, the row's line in full, each state its dot says, its set-aside mark and worktree, its moment and when it was last active where that is another, each PR with its date where GitHub gave one, and its whole note.
Its scheduled tasks and its siblings stay on their own marks' tooltips.
Every session row has it, in the grouped list, Recent, the finished view and the review alike.
A button or mark with a tooltip of its own keeps it: the dot while it has a state to report, pin, the PR, worktree, siblings, note and set-aside marks, the clock and the menu button.
The session's menu header stays as it was.

## Why

A row's line is cut to the sidebar's width, so a long name, a review line naming a PR or a note was lost where it did not fit, and the tooltips said less than the row: the title's gave the name, or why the session cannot start, and the time's only its moment.
One tooltip for the row says it all in one place and in one order, so it is the same on every row.

## Turned down

- Showing the full text only where it is cut: whether a line is cut depends on the sidebar's width, so the same row would say different things as the sidebar is resized.
- The menu header gaining the PR list and the whole note to match: the same menu already lists the PRs in its PRs submenu and opens the whole note with Edit note.
