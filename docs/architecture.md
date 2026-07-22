# Architecture

## Environment

The app targets WSL 2 with WSLg. The Electron app, the `claude` CLI it launches, and the
`~/.claude` session store all live inside the same Linux distribution, so there is no
Windows-to-WSL path translation. WSLg shows the window.

Electron needs `--no-sandbox` under WSL; the `start` script passes it.

## Processes

The standard Electron split, with the renderer locked down:

- **Main** (`src/main`) owns the window, reads the filesystem, and will own the PTYs.
- **Preload** (`src/preload`) exposes a small typed API on `window.claudeUi` through
  `contextBridge`. `contextIsolation` is on and `nodeIntegration` is off, so the renderer
  never touches Node directly.
- **Renderer** (`src/renderer`) is plain DOM, no framework yet, and talks only to the
  preload API.

## Reading sessions

`src/main/sessions.ts` walks `~/.claude/projects/*/*.jsonl`. Each `.jsonl` is one session
transcript with one JSON event per line. For each file it streams the lines to pull the
working directory and the first user message without loading the whole file, counts the
events, and takes last activity from the file mtime. The renderer groups the results by
working directory.

## Build

Two TypeScript projects, because the two sides need different module systems:

- `tsconfig.main.json` — main and preload. `NodeNext` module and resolution, emitted as
  CommonJS (the package has no `"type": "module"`), so `require` and `__dirname` work.
- `tsconfig.renderer.json` — renderer. `ESNext` module with `bundler` resolution and the
  DOM libs.

TypeScript 7 removed the old `moduleResolution: "node"`, so both projects use the newer
values above. Shared types in `src/shared` are type-only, so nothing crosses at runtime.

## Embedded terminal (planned, M2)

`@xterm/xterm` in the renderer, backed by `node-pty` in the main process running the real
`claude` binary. `node-pty` is a native module and must be rebuilt against Electron's ABI.
Keeping the real CLI in a PTY is the point: its approval prompts, diffs, and permission
modes stay exactly as they are in a terminal.

## Status cues (planned, M4)

Rather than parse terminal output to guess when a session is waiting, the app registers
Claude Code `Notification` and `Stop` hooks. The hooks report which session needs
attention or has finished, and the list lights up the matching entry.
