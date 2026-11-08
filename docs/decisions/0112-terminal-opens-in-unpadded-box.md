# A terminal opens in an unpadded box of its own

- **Date:** 2026-10-26
- **Area:** [Traps worth knowing](../architecture/ui-conventions.md#traps-worth-knowing)

## Decision

`createTerminal` opens xterm in an unpadded `.terminal-box` of its own that fills the container it is given, and a caller pads its container freely.

## Turned down

- `box-sizing: content-box` on the padded box: one line, but a trap for the next caller.
