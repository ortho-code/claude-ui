# A PR changing in a way that needs you marks every session that links it

- **Date:** 2026-10-29
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

A PR changing in a way that needs you marks every session that links it, as needing you with its changes as its reason.
Each change is told apart (`conditionsOf`) rather than from the PR's words.
Every session not finished is marked, running or not.

## Why

The PR's words name only the strongest change.
Claude working or asking shows over the mark anyway, and your next prompt there settles it.

## Turned down

- Telling the changes from the PR's words: changes requested under failing checks read as new once the checks passed, a conflict under failing checks never showed, and an approval while checks ran never read approved (found by the claim check, 2026-10-29).
- Marking only the sessions whose claude is not running: a PR merging under a running session would say nothing until it stopped.
