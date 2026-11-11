# A PR's colour follows whose turn it is

- **Date:** 2026-11-11
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

A state colours a PR's mark and its dot only where its needs-you type fires for your role on the PR, by the same `roles` that decide whether it marks a session as needing you.
A state that is someone else's to act on leaves the PR the accent, and its words say who it waits on: the author on someone else's PR, the reviewers on yours.
A PR you review with commits since your review, or your review asked, takes the colour of the needs-you type that says so, its look's colour, so changing that look or the type's roles changes the PR's colour with it.
While your role on a PR is not known, no state colours it.

## Why

The colour followed the PR's state alone, so a PR you review where you asked for changes showed the same yellow as your own PR with changes asked of you, though the work was the author's, and what was yours to do on a PR you review coloured nothing.
The needs-you types already answered whose turn each state is, so the colour gives the same answer rather than a second one.
The tone words still colour every state they did ([0102](0102-pr-colours-come-from-the-list-tone-words.md)); only the new state, yours to review again, takes a look's colour, since a tone word of its own would be a colour no other surface means.

## Turned down

- Keeping the colours and grouping a session's PRs under yours and others', with the mark rolling up only your own: two answers to one question, where the needs-you marks already give one.
- Words only, each PR led by whose turn it is, the colours as before: the colour would still say the opposite of the words on someone else's PR.
- A mark of its own, such as an outlined dot, for a PR that waits on someone else: one more mark to read, for a state that asks nothing of you.
- Colouring by state until your role is known: a colour that can flip once GitHub answers about you.
