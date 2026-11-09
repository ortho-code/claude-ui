# The title on disk stays as Claude Code writes it

- **Date:** 2026-09-22
- **Area:** [A cleared session is a new session](../architecture/claude.md#a-cleared-session-is-a-new-session)

## Decision

The title on disk is left exactly as Claude Code writes it, so a cleared named session goes on wearing the name its predecessor handed it.

## Why

`claude --resume` lists that session under the copied name, and an app that showed a different one would put two names on one session.
Staying legible next to the CLI beats being tidier than it.
In practice the case is narrow — 127 of 710 transcripts here carry a name at all, so clearing an unnamed session already produces a blank one with no help from us.

## Turned down

- Telling the copy apart, by where it sits or because the app alone sees the end and the start arrive on one terminal: an earlier version did exactly that, and it was removed for the reason above.
