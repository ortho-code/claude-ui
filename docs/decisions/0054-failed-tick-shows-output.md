# A failed tick shows what it printed

- **Date:** 2026-10-07
- **Area:** [The `command` type](../architecture/panels.md#the-command-type)

## Decision

A tick that fails shows what it printed, as a failed press does.

## Why

A command's failing output is usually what it has to say, where a list's broken document has nothing to show.

## Turned down

- The list's rule, the last good output kept under a line saying the run failed: a command's failing output is usually what it has to say.
- Keeping the last output only when the app cut a run short (30 s, 1 MB): the one to take if such stops turn out to be common.
