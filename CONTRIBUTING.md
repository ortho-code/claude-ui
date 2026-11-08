# Contributing

How to run claude-ui from source, and where things are.
What the app holds to, and what a change is checked against, is in [docs/principles.md](docs/principles.md); how it is built is in [docs/architecture.md](docs/architecture.md).

## Run from source

- Linux or macOS, or Windows through WSL 2 with WSLg, where the app and `claude` both run inside the Linux distribution.
- Node, managed by [mise](https://mise.jdx.dev).
  Run `mise install` once.
- A C toolchain for the native terminal module: `sudo apt-get install build-essential` on Debian or Ubuntu, `xcode-select --install` on macOS.

```bash
mise install
npm install
npm run rebuild   # build node-pty against Electron's ABI
npm start
```

`npm start` builds and launches the app.
It runs with `--no-sandbox`, which WSL requires.

`npm test` runs the unit tests, and `npm run test:renderer` checks the window itself in a headless browser, which `npx playwright install --only-shell chromium` fetches the first time.
Which of them a change needs is in [the architecture notes](docs/architecture.md#which-checks-a-change-needs).

To produce installable builds: `npm run dist:linux`, and `npm run dist:mac` on a Mac.
Artifacts land in `release/`.
Tagging a version runs CI's checks on it, then builds both on CI and publishes them as a release.

## Project layout

- `src/main` — Electron main process: window and IPC.
- `src/main/sessions.ts` — reads and summarizes `~/.claude/projects`.
- `src/preload` — the bridge the renderer uses to reach the main process.
- `src/renderer` — the window UI.
- `src/renderer/state` — the store the window's surfaces share, and what more than one of them reads from it.
- `src/renderer/panels` — the layout tree and the panel types: `panels/types/sessions` (the sidebar), `panels/types/claude` (the terminal area), and the others.
- `src/shared` — types and pure helpers shared by both sides, and main's rules the window's checks answer with.
- `test/` — the tests: unit tests in `test/unit/`, mirroring `src/`, the rules every comment and doc keeps in `test/text/`, and the window's checks in `test/renderer/`, filed by the panel or surface they check.
- `docs/` — architecture and design notes.
