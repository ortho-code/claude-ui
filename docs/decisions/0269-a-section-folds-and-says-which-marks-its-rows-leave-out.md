# A section folds, and says which marks its rows leave out

- **Date:** 2026-11-25
- **Area:** [Views with sections](../architecture/session-list.md#views-with-sections)

## Decision

A section of a view can fold: a press on its heading folds or unfolds it, kept for as long as its panel is mounted, so lost when the panel leaves the layout, its options change or the app restarts.
It can also name the marks its rows leave out, as a list of what to hide; every other mark shows.
Now's sections all fold, and leave out the pin, the set-aside mark, the worktree mark and the siblings mark, keeping the PR mark, the note, the scheduled clock and the mark of an older copy.

## Why

The list panel Now replaces folded its sections, and a list panel keeps its folds the same way, so one question has one answer on both.
A pin says where a row belongs in the session list, the set-aside mark is said in words on the row's lines in every section but Elsewhere, whose rows say it on hover, and the worktree and siblings marks are about how the session list is organised; the PR mark is the quickest way to a session's PRs.
A list of what to hide lets a mark added later show by default, and hiding loses no action, since the row's menu holds every one.

## Turned down

- Keeping folds across restarts: no list panel does, and the two would then answer one question differently.
- A list of the marks to show, which a mark added later would be missing from.
- A setting for which marks every row shows, which waits for the rethink of how a session row is laid out.
