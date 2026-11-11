# A PR opened in the browser is looked for by its branch

- **Date:** 2026-11-11
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

A session's `gh pr create --web` that names both the repository and the branch is kept with its time, and the window has main look for the PR made from that branch in that repository after the command ran, every five minutes for 30 days, until it is found.
The one found is linked to that session as the app's own link, as a panel row's PR is.
A command that leaves the repository or the branch to the checkout is left out.

## Why

`gh pr create --web` prints no PR, since the PR is made in the browser afterwards, and Claude Code links none for it, so a session that opened its PR this way showed none.
The command itself names the repository and the branch exactly, so the PR is found without guessing from the folder, and taking only one made after the command keeps an older PR of a reused branch out.
30 days covers a PR submitted whenever you get to it, and asking stops for good after that, so a create never submitted is not asked about for ever; taking only a PR made after the command keeps a long window from linking the wrong one.

## Turned down

- Any unlinked open PR on a branch the session pushed: it would cover a PR opened by hand on GitHub too, but cannot say which session it belongs to when several share a folder.
- Leaving it to Claude Code: a push in the same command as `gh pr create` skips its own lookup, which would have caught the PR once it existed, but reporting that is not something the app can rely on.
- A day, first built: a PR submitted days later, as one was on 2026-11-11, stayed unlinked.
- Asking for ever: a create closed unsubmitted in the browser would cost a request every five minutes for good.
- A command without `--repo`, read as the folder's default repository: which remote `gh` picks follows rules of its own, the same reason a bare PR number is left out.
