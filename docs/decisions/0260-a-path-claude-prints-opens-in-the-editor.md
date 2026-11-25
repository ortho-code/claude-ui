# A path claude prints opens in the Editor

- **Date:** 2026-11-25
- **Area:** [The `editor` type](../architecture/panels.md#the-editor-type)

## Decision

A file path claude prints in a session tab's terminal is a link that opens the file in the Editor, as a press on a file in the history does: absolute, from the home folder, or relative to the session's folder as the listing knows it, and only where it names a file on disk.
A line number after it, `:42`, brings that line into sight, opening the fold it sits in under Changes only.
A `file://` link claude sends as a hyperlink opens its file in the Editor too, rather than nothing.
A panel's shell gets none of this for now.

## Why

Claude names the files it worked on in its replies, and reading one meant finding it in the Explorer or in the history first.
Asking main whether a piece names a file keeps words that only look like paths, a version or an abbreviation, from becoming links.
The session's folder is what claude's relative paths are written from; a panel's shell runs in a folder of its own, and its output is often a tool's paths, which would need that folder instead.
Claude 2.1.330 was not seen to send a `file://` link for a path it prints, so the paths are found in the text; a `file://` link is opened all the same, at little cost, though xterm then underlines every link that is no web address, a press on one that is no file saying only web addresses open.

## Turned down

- Every terminal, a panel's shell included, each read from its own folder (decided 2026-11-25): wanted later, as a step of its own.
- A `:42` inside a fold going to the nearest change instead: the line asked for is the one wanted.
