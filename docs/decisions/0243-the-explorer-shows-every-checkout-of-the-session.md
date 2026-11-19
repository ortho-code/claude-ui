# The Explorer shows every checkout of the session

- **Date:** 2026-11-19
- **Area:** [The `explorer` type](../architecture/panels.md#the-explorer-type)

## Decision

The Explorer is one tree over the session's checkouts, each a root with a row of its own: the checkout the panel looks in first, then the other checkouts of the repository the session's record lists, newest change first, then the repository's main checkout when the record lists no change there, folded, its row saying how many files others changed there; a listed checkout with no change, the worktree the session's mark names, starts folded too.
Each root's row names its folder, then the branch it has out, behind the branch mark a worktree session's tab wears, where it is not the folder's own name, then its count at the end; its files sit under it inside the index line a custom group's sessions have in the session list, as a tree or flat, and the Editor steps from the last file of one open root into the first of the next.
With two roots or more, a jump at the end of the row over the list opens a menu of the roots with their counts, as a project heading's jump lists its groups; a press brings that root to the top, unfolded.
The roots come from the session's record in the window, as its worktree mark lists its checkouts, so finding them asks main nothing; a panel with a folder of its own has that one root.
Folders the session wrote to outside every repository are not roots yet: they need a record of which of its writes succeeded, which the app does not keep; repositories nested inside a root are not roots yet either.

## Why

A session that works in a worktree and touches another, or the main checkout, changed files in more than one place, and a panel that showed only the one it looks in hid the rest.
The record already lists the checkouts, so the roots cost no new reading.
The main checkout folded keeps others' changes in sight without putting them among the session's own.

## Turned down

- Asking main for the roots, with the folders written to: written-to folders need a record of which writes succeeded, which is built with the view of what the session touched, and building it twice, or half now, was not worth it (decided 2026-11-19).
- A root row only when there is more than one root: one look for every panel, and the branch in sight with one root too.
- The branch on a line of its own under the root's name: it read as a folder inside the root, and a branch with the folder's own name, as a worktree made for one branch often has, says nothing the name does not (decided 2026-11-19).
