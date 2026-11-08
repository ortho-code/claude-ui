# An exited shell comes back on a key press

- **Date:** 2026-09-24
- **Area:** [The `terminal` type](../architecture/panels.md#the-terminal-type)

## Decision

A shell that exits keeps its screen up with a line saying any key starts a new shell, and the next key does, as VS Code's terminal does.

## Turned down

- A button that appears only once the shell has gone.
- Restarting on exit by itself: it would need a guard against a shell that dies at once, a broken rc file say, starting again forever.
