# A PR reason GitHub takes back is settled

- **Date:** 2026-11-14
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

A session's reason for a PR's failing checks, merge conflict or requested changes is settled as soon as GitHub no longer says it: failing checks once GitHub no longer reports them failed, as when they run again or pass, a conflict once GitHub says there is none, changes requested once the review no longer asks for them, and all three once the PR is merged or closed.
It moves to the session's history as settled `resolved`, the PR's other reasons, such as an approval found with the failing checks, staying.
It always works this way, with no setting, while the app asks GitHub about the PR: with PR status on, and a session still linking it.

## Why

The mark said the PR needed you for something that was no longer so, until you acted on the session, and a reason that is no longer true reads as a bug.
Checks that run again are no longer failing, so the reason goes then, not only once they pass.
A conflict GitHub is still working out after a push says nothing yet, so it keeps the reason, whatever was seen before.
An answer in which a request to GitHub failed, a PR it has no status for, or an answer that came while what was last seen could not be read settles nothing: the first two say nothing of the PR, and the last is not kept as what was last seen, so failing checks that come back would not mark again.
The other reasons are settled as before: an approval, merged or closed, new commits and your review asked are news that GitHub does not take back.

## Turned down

- A setting to keep such a reason until you act: no one has asked to see a state that no longer holds; one can be added if that changes.
- Settling only on checks that pass: a run under way is no longer a failure, and the run failing marks again, as any change into failing checks does.
