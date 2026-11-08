# Where a session works is the checkout it last changed a file in

- **Date:** 2026-10-26
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

Where a session works (`workCwd`) is the checkout, the main one or a linked worktree of the session's repo, holding the newest file claude changed with its file tools.

## Why

Over one machine's transcripts that touch a worktree (112 sessions, 2026-10-26), asked at each of the 2,760 prompts followed by a change where that next change went, the last change was right at 94% of them.
The measure takes the next change as the right answer, which favours this rule by construction; the six days of changes in a worktree under records naming the main checkout (below) do not depend on it.

## Turned down

- The records' `cwd`, weighed first: it does not say where a session works; one session left its worktree by `ExitWorktree` and made 75 changes in it by path over six days while every record said the main checkout, and its records later moved back to the main checkout with remote work, with a `cd` into a temporary folder, which claude's shell answers by returning to the folder it started in, and after a pause, none of them with a change there; by the measure above, the records' latest `cwd` was right at 91%, moving the panels 268 times against 78.
- The latest worktree the records reached: right at 92%, and it never comes back to the main checkout.
- The worktree records alone, the reading before this: right at 87%.
