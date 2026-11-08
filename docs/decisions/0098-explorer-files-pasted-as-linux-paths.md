# Files copied in Explorer paste as Linux paths

- **Date:** 2026-10-21
- **Area:** [The `terminal` type](../architecture/panels.md#the-terminal-type)

## Decision

Under WSL a paste with no text that turns out to be files copied in Explorer pastes their paths, each mapped by `wslpath -u`.

## Turned down

- Windows paths, as Explorer's Copy as path gives them: a panel's shell cannot use them.
