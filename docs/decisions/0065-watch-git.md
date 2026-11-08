# A panel watching git looks at a fingerprint every 30 seconds

- **Date:** 2026-10-08
- **Area:** [The `command` type](../architecture/panels.md#the-command-type)

## Decision

`watch: git` runs a panel again when its working tree changes, found by asking git for a fingerprint of it every 30 seconds.

## Why

A watch per directory measured 44,287 watches and 160 MB on a large repository, and Node's recursive watch takes one per file and per directory, past the system's limit there unfiltered, while the git command took 0.07 s.

## Turned down

- A watch of the folder: the watch counts above.
- A run when a session in the folder ends its turn: it misses an editor's edits.
- Looking only while shown: it would leave the rail's dot stale.
- A period of 2 seconds: 30 seconds was chosen over it.
