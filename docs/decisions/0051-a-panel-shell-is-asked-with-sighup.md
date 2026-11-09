# A panel's shell is asked to stop with SIGHUP

- **Date:** 2026-10-07
- **Area:** [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question)

## Decision

A panel's shell is asked with `SIGHUP` rather than `SIGTERM`, the signal a closing terminal sends.

## Why

An interactive login shell in a pty, bash, zsh and dash alike, was measured still there 5 s after `SIGTERM`, and gone at once after `SIGHUP`, idle or with a command running in it.

## Turned down

- `SIGTERM`: every shell waited out the grace for its `SIGKILL`, and held the quit up for as long; a command that ignores `SIGHUP` outlived `SIGTERM` too, as it now outlives the shell.
