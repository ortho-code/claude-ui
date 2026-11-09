# The app never forces a session because an ask went unanswered

- **Date:** 2026-10-21
- **Area:** [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question)

## Decision

The app forces a session out on its own only when you quit, when its window closes on macOS, when its tab is removed while its claude is still starting, and when a claude's `/resume` takes a session another tab runs, and never because an ask went unanswered.
