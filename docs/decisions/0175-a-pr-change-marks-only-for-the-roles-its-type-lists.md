# A PR change marks only where its type fires for your role

- **Date:** 2026-11-06
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

A change marks only where its type fires for your role on the PR (`roles` in the type's file).
Failing checks, a conflict, changes requested and approved ask the author to act, so as shipped they fire on your own PRs alone; new commits since your review and your review asked fire for a PR you review; reopened, merged and closed fire for every role.

## Why

Before, a review session was marked for a colleague's red checks.
