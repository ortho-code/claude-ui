# Links open through Windows under WSL

- **Date:** 2026-11-13
- **Area:** [Links](../architecture/window.md#links)

## Decision

Under WSL main opens an http(s) link by handing it to Windows' own handler for it, `rundll32.exe url.dll,FileProtocolHandler`, from Windows' own folder when interop leaves Windows off the path.
Elsewhere it uses Electron's `shell.openExternal`.
A link that could not be handed on is logged and shown in a toast with why.

## Why

`xdg-open` makes the same call under WSL (xdg-utils 1.2.1), but Electron does not wait for `xdg-open`, so when the call fails nothing hears of it.
It failed that way when the WSL session the app was started from lost its way to Windows: every Windows call from the app hung, and a pressed link did nothing, without a word.
Made by the app, the call's failure reaches main, and failures show: a press that opens nothing looks like a press that was not felt.
What it cannot tell is whether the browser took the link, since rundll32.exe gives no exit code for that.

## Turned down

- `wslview`: a package of its own that may not be installed.
- Running `xdg-open` itself to read its exit code on plain Linux: it runs the browser command in the foreground, so with a browser that does not hand off to a running one it can block until that browser exits.
- Mending the app's way to Windows when it breaks, by pointing it at another interop socket: that is the WSL setup's to keep, not the app's.
