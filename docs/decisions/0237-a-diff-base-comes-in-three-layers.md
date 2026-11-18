# A diff's base comes in three layers

- **Date:** 2026-11-14
- **Area:** [The `explorer` type](../architecture/panels.md#the-explorer-type)

## Decision

Since branched measures from the merge-base of `HEAD` with a base branch, found by the first of three layers that gives one that resolves: a base kept for the branch, then one kept for the project, then the convention's guess.
The convention takes the default branch of a remote named `upstream`, else of `origin`: its `HEAD` where git knows it, else the first of `develop`, `main` and `master` on it.
The kept bases are this machine's, in `meta.json`, keyed by the project's folder, and the header says where the base in use came from.
Nothing fetches: a base is measured as the remote branches stand locally.

## Why

Neither remote name is a given: `origin` is only git's default for the remote a clone came from, and `upstream` a habit for a fork's original.
A fork measured against `origin` alone counted thousands of commits as the branch's own, since a fork's own copy of the base branch is often months behind the original; measured on one such clone, 6,111 commits against 26.
A convention is a fine starting point where it can be changed, and a branch stacked on another needs that branch as its base while the rest of the project keeps its own, so a pick belongs to the branch.
A repository's folder differs per install, so a kept base is not a setting to share.

## Turned down

- `origin/HEAD` alone, git's own pointer: wrong for every fork.
- A setting with no guess at all: every project would start with no Since branched until one is set.
- Picking the candidate that counts the fewest commits as the branch's own: a guess dressed as a measurement.
- A per-project setting in `settings.json`: it is shared, and holds nothing per project.
- Fetching on a timer: a stale base only leaves out commits not had yet, and moves when the person fetches or rebases.
