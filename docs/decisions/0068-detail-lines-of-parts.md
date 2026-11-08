# A row's detail is lines of parts, with no string form

- **Date:** 2026-10-14
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

A row's `detail` is lines of parts rather than a string, and there is no string form beside it.

## Why

A part can be a link of its own, and the separator between parts is the app's to draw rather than characters inside the script's text.
Panel types had not shipped when it changed (2026-10-14), so nothing written for the string had to keep working, and a second way to write the line would have been the one that puts the separator back in the text.

## Turned down

- A string form beside it: it would have been the one that puts the separator back in the text.
- A `links` field drawn after `detail`: it kept the separators in the text and put links at the end of the line only.
- Markup inside `detail`: nothing here ever draws markup.
- A line break written as `\n` in a string: it leaves the lines implicit.
