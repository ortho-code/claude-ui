# Undo starts claude again where it was running

- **Date:** 2026-11-11
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/claude.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

The Undo a close or a finish offers starts claude again, resuming its conversation where it has one, in each tab it puts back whose claude that close or finish asked to leave, unless the session's folder has gone.
A tab that was cold when it was closed or finished comes back cold, and so does one whose claude a stop had asked to leave before the close or the finish took its exit over, since the stop had ended it.
`undoRunning` in the settings chooses: `"start"`, the default, or `"cold"`, which brings every tab back without starting it, as Undo did before.

## Why

Undo is there to put things back as they were, and a tab that was running is only back as it was with its claude running.
A tab put back cold left you a press short of where you were, after you had already pressed Undo to get there.
The choice is a setting because starting claude starts processes, which someone may not want from an Undo; it takes the same words as `runningSessionsAtLaunch`, which answers the same question at launch.

## Turned down

- Always starting claude again: no way to have the tabs back without their processes.
- Leaving Undo as it was, cold: a running tab never came back as it was.
- A turn claude was in the middle of carried on: the leave interrupted it, so claude resumes at its prompt.
