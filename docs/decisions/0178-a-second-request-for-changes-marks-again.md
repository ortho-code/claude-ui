# A second request for changes marks again

- **Date:** 2026-11-06
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

A second request for changes while one already stands, another reviewer's or a new round of the same one's, marks again (`asksForChangesAnew`).

## Why

GitHub's review decision stays changes requested throughout, so a new request is told from the ids of each reviewer's latest review asking for changes, a new id being a new request.
