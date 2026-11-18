# Files open in an Editor beside the session

- **Date:** 2026-11-18
- **Area:** [The `editor` type](../architecture/panels.md#the-editor-type)

## Decision

Files and their diffs open in one place of the app's own, the Editor, a panel type the layout places beside the terminal area.
It takes no room while nothing is open in it, and opens to its kept size when a file does, so the session and the other panels stay usable while you read.
The layout places it at most once: a file that leaves it out gets it as a column right after the one holding the terminal area, with nothing said, since it costs no room until used, and `"hidden": true` on its entry switches it off.
Files open in tabs, one set per session tab; a single press opens a preview the next file takes the place of, and a double click keeps one.
A file is shown whole by default, its changes marked in place, with Changes only to fold the rest.
The diff panel becomes the list of changed files, and its diff moves here.
It is called the Editor though it only reads for now, because reading is the first of what it will do: whatever it cannot edit carries a "read only" mark.

## Why

A panel at its usual size is too small to read a diff, and full screen hides the session while you read, so neither lets you read and go on working at the same time.
An area that opens only when something is in it gives the room without taking it the rest of the time.
One place for everything that needs room keeps the panels narrow lists, and a file opened from anywhere lands in the same spot.
A name that stays true once files can be edited spares every layout file a rename later; the read-only mark keeps it honest until then.
A preview that the next file takes the place of keeps tabs from piling up, which would be one more thing to keep up with.
The whole file shows a change where it sits among the code around it; Changes only is there for the long file with a few changes.

## Turned down

- Widening a panel on a press, between its usual size and full screen: cheap, but the files stay inside the panel that lists them, one at a time.
- A window of its own for reading files only: the most room, but on one screen it covers the window it belongs to, and extra windows are unreliable under WSLg; a tab moved to a window of its own is a later step on top of the Editor instead.
- Named layouts switched by a key: general, but heavy for opening one file.
- Calling it Documents or Viewer: Viewer stops being true once files can be edited, and Documents is vaguer than what it holds.
- Placing it exactly once, as the session list and the terminal area are: someone may have a reason not to want it, and a window without it still works.
- One set of tabs for the whole window: a session's files would stay on show beside another session's work.
- The diff panel keeping its own diff beside the list: the panel stays a narrow list, and a file opened from anywhere else would land somewhere else.
