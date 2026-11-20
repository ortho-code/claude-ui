# Each checkout answers its own question

- **Date:** 2026-11-20
- **Area:** [The `explorer` type](../architecture/panels.md#the-explorer-type)

## Decision

Each checkout in the Explorer answers the panel's question, or one it is set to on its own.
A checkout's row ends in a kebab, whose menu names its branch and what it is measured from, once git has read the checkout, then Follow the panel with the panel's question, ticked while the checkout follows it, then the three questions with the commits each counts in that checkout, the one it is set to ticked.
A checkout set on its own says its question on its row, before its count, and that mark never shrinks: the branch gives way first, then the name.
The question in the row over the list sets every checkout, those set on their own included, and reads Mixed while any checkout it shows is set on its own, as that checkout's row says, the panel's own question included.
With more than one checkout the row over the list names no base and its menu counts no commits, since its pick sets them all; each checkout's menu says both for itself.
The questions are kept in the panel's data file, a checkout's by its folder, and main forgets the question of a checkout whose folder is gone when it reads the file.
A file opened from the Explorer carries, for every file it steps through, the question each checkout's list answered then, so a step from one checkout into another follows the second for its own.

## Why

Checkouts of one session are often in different states: a worktree with its own branch to review since it branched, beside another where only what is not committed yet matters.
One question for every checkout made one of them always the wrong one.
A checkout rather than a repository, since a worktree and the main checkout of one repository have different branches, and a question is asked of a branch.

## Turned down

- A press on the checkout's branch: a worktree whose branch has its folder's name shows no branch, and so had nothing to press (decided 2026-11-20).
- Follow the panel only once a checkout is set on its own: always there and ticked, it says that the checkout follows the panel (decided 2026-11-20).
- "Same as the panel" for that item: Follow the panel says what a press on it does (decided 2026-11-20).
- No mark on the row, the question in its tooltip only: a count that differs from its neighbours' needs its reason in sight (decided 2026-11-20).
- A mark that drops its word to a dot in a narrow panel: a second rule for one mark, to add only if narrow panels turn out to need it (decided 2026-11-20).
- The first checkout's base and counts in the row over the list whatever the number of checkouts: a menu that sets every checkout would count only one of them (decided 2026-11-20).
- The questions only for the run: the panel's question is kept, and a checkout's own one is the same kind of pick.
