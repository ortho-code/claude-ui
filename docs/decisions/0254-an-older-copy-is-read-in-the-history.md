# An older copy is read in the history

- **Date:** 2026-11-24
- **Area:** [In-session history](../architecture/history.md#an-older-copy)

## Decision

A session's older copy of its transcript ([0253](0253-a-superseded-copy-is-marked-on-its-row.md)) is shown in the session's own history, through a switch in its head between Current and each copy, read-only: no pins, and its requests the current transcript lacks edged.
A press on the row's mark opens the newest copy there, in the session's tab, without starting claude; in the finished view it opens nothing, as a press on a finished row does not.
A tab always comes back on its transcript.

## Why

The history already draws a transcript as claude shows it, so a copy drawn there reads like the session it is, and the switch keeps the two side by side, one press apart.
What the current transcript lacks is what the copy is for, so it is what stands out.
Pins are kept in the app's own file, keyed by record id (a message's also by its place in the record), and a pin made on a copy would point at a request no history of the session shows once the copy is deleted.
Reading a copy needs no claude, and starting one to read it would resume the session, which is how a split begins.

## Turned down

- A view of its own for the copy, beside the history: a second way of drawing a transcript, kept in step with the first by hand.
- Remembering per tab that a copy was on show: a copy is looked into, not worked in, and coming back to it would hide the transcript the tab is about.
- Opening the copy with the session's own tab press, which starts claude.
- In the finished view, a press on the mark that reopens the session and then shows the copy: a press on a finished row opens nothing, so a stray one cannot reopen a session, and the mark keeps that rule.
