# Finished is one press, and the mark waits for claude to go

- **Date:** 2026-10-28
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)

## Decision

Finished is one press: a running session's claude is asked to leave as a close asks it, and its exit removes the tab and marks the session finished.

## Why

Writing the mark at the exit is what answers the problem of the earlier one press, so the claudes the app asked do not run a finished session.

## Turned down

- One press that stopped and marked finished together, turned down on 2026-10-19: it wrote the mark at the press and left a finished session with a live tab while its claude left.
