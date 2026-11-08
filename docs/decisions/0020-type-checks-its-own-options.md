# A panel type checks its own options

- **Date:** 2026-09-24
- **Area:** [A type owns its options](../architecture/panels.md#a-type-owns-its-options)

## Decision

A panel type checks its own options, what a path points at included, when it is mounted, before every run and whenever the config folder changes.

## Why

A path relative to the selected project, which the `cwd` option needs, changes while the app runs, so no read of the file can answer it.
A layout that knows a type's option names is a layout every new option has to touch.
The cost is that a missing file is named when the panel checks rather than in the same read as the file's shape: the same place on screen, a moment later.

## Turned down

- Main checking every `script` in the file when it read it, so one read named everything, as at first: no read of the file can answer a path relative to the selected project, and the layout would have to know every type's option names.
