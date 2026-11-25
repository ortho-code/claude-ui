# Every created PR is looked for by its branch

- **Date:** 2026-11-23
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

Every `gh pr create` a session runs that names both the repository and the branch is kept with its time and looked for by its branch, with or without `--web`, as a PR opened in the browser already was ([0209](0209-a-pr-opened-in-the-browser-is-looked-for-by-its-branch.md)), and the one found is linked as the app's own.
A create Claude Code linked too is asked about all the same.

## Why

Claude Code links a PR created without `--web` only when the command's output still holds the PR's address, and a session that pipes that output through a `tail` shorter than the lines `gh` prints after the address keeps none of it, so the session showed no PR.
The command names the repository and the branch whatever its output says, and a create that succeeded made its PR before the next ask, so that ask finds it and asking stops for as long as the window is open; after a launch it is found once more.
A create that failed is asked about every five minutes until its 30 days have passed, as an unsubmitted `--web` one is.

## Turned down

- Skipping a create Claude Code already linked: its link names no branch, so telling which create it belongs to would be a guess, while asking adds its branch to the request the waiting creates already share, and the PR shows once either way.
- A rule for sessions never to filter `gh pr create`'s output: only as good as each session following it.
- Waiting for Claude Code to fall back to the branch when the output names no PR: not something the app can rely on, as for a push in the same command (0209).
