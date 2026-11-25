# A comment posted by number links the PR it is on

- **Date:** 2026-11-23
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

A comment a session posts by an issue's number, through a `gh api` POST to `repos/<owner>/<repo>/issues/<number>/comments` or `gh issue comment` naming the repository, is kept with its time, and the app asks GitHub whether that number is an issue or a PR in that repository, as it looks for a created PR ([0209](0209-a-pr-opened-in-the-browser-is-looked-for-by-its-branch.md)) and a review posted by its id ([0233](0233-a-review-posted-through-graphql-is-found-by-its-id.md)).
A PR is linked as the app's own; an issue links nothing, and is not asked about again while the window is open, unless the session comments on it again.

## Why

GitHub takes a PR's conversation comments under the issue's endpoint, and sessions post them there, so a session that only commented on a PR's conversation showed no PR.
The number alone does not say which it is, since issues and PRs share one count; linking it as a PR unasked would link an issue as a PR, whose status no PR ask could then answer.
GitHub says for sure, at one small ask per number, and an issue becomes a PR only when someone converts it through GitHub's API, so asking stops there until the session comments on it again.

## Turned down

- Issues as links of their own, with their state: a new kind of link, which belongs with the other kinds a session can link, not beside a fix to the PRs it already does.
- Reading the posted comment's address from the command's output, which names a PR's page for a comment on its conversation: it is there only when the command prints it, and a `--jq` or a filter on the output can leave it out, as a cut output left out a created PR's ([0250](0250-every-created-pr-is-looked-for-by-its-branch.md)).
