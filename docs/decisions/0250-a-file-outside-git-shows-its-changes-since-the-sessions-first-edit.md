# A file outside git shows its changes since the session's first edit

- **Date:** 2026-11-23
- **Area:** [The `editor` type](../architecture/panels.md#the-editor-type)

## Decision

A file git has nothing to compare with, one no repository holds or one its repository ignores, opens in the Editor with its changes since the session first changed it: the text it had then, against the file as it is now, as one diff drawn as any other.
That text is the one Claude Code records with the change: none for a file a Write created, and the `originalFile` an Edit or a Write that replaced the file keeps; the first change that succeeded counts, the session's own or a subagent's, whichever came first.
A NotebookEdit's result names that text otherwise, and no local transcript held one to read it from, so a notebook reads as one whose text is not recorded.
Where that text is not recorded, the file is shown as it is, with a line saying its changes cannot be shown; a file the session never changed is shown as it is, with nothing said; a file no longer on disk says only that.
The header says "Since this session's first edit", since the file as it is now may hold changes made by other means since.
A file a tool call names in the history opens in the Editor on a press: a file of a checkout as a press on its row in the Explorer opens it, compared with the question a reader of that checkout already follows, else Since branched; any other file as above.

## Why

Scratchpad files, plans and notes outside a repository are part of what a session works on, and git has nothing to say about them.
Claude Code records the text before the first change for most files: measured over every local transcript on 2026-11-21, for 11,916 of 14,828 files a session changed, and 5,205 of 5,511 outside the folder it started in.
One diff, drawn as a checkout's file is, needs no second way of drawing, and keeps the whole-file view, Changes only and the stepper working.
The app keeps no copy of that text of its own, which Claude Code already keeps in the transcript.

## Turned down

- Each recorded edit's own hunks in order, from `structuredPatch`: works for every file, but needs a second way of drawing, each edit's line numbers are its own, and no whole-file view can hold them; it can be added later, since the transcript keeps every edit.
- For a file no longer on disk, its last version rebuilt from the transcript, the last Write's content or the edits applied in order (decided 2026-11-25): larger, and certain only where every change is recorded; maybe later.
- A file of a checkout compared with the session's own edits too: the same file would then have two different diffs, by where it was opened.
- Claude Code's `file-history-snapshot` records as the source: they point at backups in files of their own, whose format the app has not read, where the change's result already holds the text in the transcript the app reads anyway.
