# A resume or clear during a leave calls the leave off

- **Date:** 2026-10-28
- **Area:** [Stopping a session is a request: claude may answer it with a question](../architecture/claude.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question)

## Decision

A `/resume` or `/clear` while claude is on its way out clears the stop, whatever the leave was, a stop, a close or a finish.

## Why

The app hears of either as a start of another session reported from the tab, which is going on working: a stop, a pause, as there was then, a close or a finish left incomplete for something else is one called off.
It used to leave the tab saying it was stopping, in the session claude went on in, and a finish's exit would then have marked that session finished.
