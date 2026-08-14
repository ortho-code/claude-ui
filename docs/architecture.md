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

## Status cues

Rather than parse terminal output to guess a session's state, the app drives status from
Claude Code hooks. On startup it writes a small hook script to `~/.config/claude-ui/` and
merges hook entries into `~/.claude/settings.json` (preserving any existing hooks). The
events map to statuses: `UserPromptSubmit` → busy, `Stop` → idle, `Notification` → waiting,
`SessionEnd` → closed.

The hooks are scoped to claude-ui: it sets `CLAUDE_UI=1` on the terminals it spawns, and
the hook script no-ops unless that variable is set, so sessions run in a plain terminal are
left untouched. When it does fire, the script writes `~/.config/claude-ui/status/<id>.json`.
The main process watches that directory and pushes updates to the renderer, which shows a
dot per session: busy, idle, waiting, or hollow (`closed` and unknown states have no color).

## UI conventions

Any control that opens a menu or popover keeps its active look (the same fill or outline it
shows on hover) for as long as the menu is open, including when the pointer moves off it. The
shared `openMenu` helper stamps `.menu-open` on the trigger while its menu is up, so give every
such trigger a `.menu-open` style that matches its `:hover`. The kebabs, the split-button caret,
and the `⑂ N` sibling-count badge all follow this.

Every menu/popover also reads as attached to its trigger: `openMenu`/`openSubmenu` add an
`attach-top`/`attach-right`/`attach-left` class and set `--notch-x`/`--notch-y`, which position a
small notch on the menu's edge pointing at the trigger's center. Anything new that floats near an
anchor should go through those helpers so it gets the notch (and the active-state stamping) for
free rather than reinventing positioning.
