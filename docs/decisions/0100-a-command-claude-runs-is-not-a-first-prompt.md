# A command Claude runs itself is not a session's first prompt

- **Date:** 2026-10-22
- **Area:** [Reading sessions](../architecture/sessions.md#reading-sessions)

## Decision

A command Claude runs itself, such as `/clear`, `/model` or `/effort`, is not a prompt, so a session that opens with one is `New:` until something is typed in it.

## Why

The app once took such a command for the first prompt and named sessions `/clear` and `/model`, which Claude itself never does: none of the 284 titles it generated on one machine (2026-10-22) starts with `/`.
