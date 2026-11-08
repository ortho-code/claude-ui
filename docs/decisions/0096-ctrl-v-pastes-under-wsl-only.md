# Ctrl+V pastes under WSL, and only there

- **Date:** 2026-10-21
- **Area:** [The `terminal` type](../architecture/panels.md#the-terminal-type)

## Decision

Under WSL every terminal hands Ctrl+V back to Chromium's own paste; elsewhere Ctrl+V goes on to the program.

## Why

Under WSL claude reads `^V` as "paste an image" and looks for one before it falls back to the text, through a `powershell.exe` call that took ten seconds the first time it was measured, while an empty paste still reaches claude there as an image paste.

## Turned down

- The same on every platform: for the image paste it costs.
- Claude's tabs only: it would answer one key two ways with nothing to say why.
- Passing Ctrl+V to claude only while the clipboard holds an image: it needs a look at the clipboard's formats that claude's empty paste already makes unnecessary.
