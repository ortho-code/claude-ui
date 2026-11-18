# A review posted through GraphQL is found by its id

- **Date:** 2026-11-18
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

A review or comment a session posts through a GraphQL mutation links its PR: the app keeps the id the mutation names, of a review, a review thread, a review comment or a PR, and asks GitHub which PR it belongs to, as it looks for a PR opened in the browser ([0209](0209-a-pr-opened-in-the-browser-is-looked-for-by-its-branch.md)), linking the one found as its own.
A mutation counts when it posts: adding a review, a review thread, a reply in a thread or a review comment (`addPullRequestReviewComment`, which GitHub deprecates), submitting a review, or adding a comment; resolving a thread does not.

## Why

Sessions added comments to a review a person had started by hand on the PR, which GitHub's REST API cannot, and the session then showed no PR at all.
GitHub says for sure which PR an id belongs to, at one small ask per id.

## Turned down

- Reading the mutation's printed answer for the PR's address: it is there only when the command asks for a URL, which most commands adding a comment did not, though the submit did in four of the five sessions seen; a session that adds comments and leaves the submit to a person would link nothing.
- Leaving it to a mention of the PR's address in the session's prompt: that would show a PR the session talked about, not one it posted on.
