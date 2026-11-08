# A leaving claude that resumes a held session is forced too

- **Date:** 2026-10-28
- **Area:** [A resumed session is the session it was](../architecture/terminal.md#a-resumed-session-is-the-session-it-was)

## Decision

A claude you had asked to leave, whose `/resume` takes a session another tab runs, is forced out the same way, its leave called off.

## Why

It is a second claude in the session either way.
It used to be left running, as the check for a claude already forced was whether it was leaving at all.
