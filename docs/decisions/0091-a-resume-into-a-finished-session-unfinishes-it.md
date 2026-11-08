# A resume into a finished session makes it unfinished

- **Date:** 2026-10-20
- **Area:** [A resumed session is the session it was](../architecture/terminal.md#a-resumed-session-is-the-session-it-was)

## Decision

When claude's own `/resume` lands in a finished session, that session is made unfinished as soon as the app hears of it, and a toast says so.

## Why

Finishing is this app's, and claude cannot see it, and claude has already gone on in it.

## Turned down

- Refusing it, stopping claude and giving the tab back the session before: claude cannot be stopped from switching, since `SessionStart` cannot block and `/resume` fires no `UserPromptSubmit` (measured), so refusing means ending a claude you just asked for something and losing what you had typed.
