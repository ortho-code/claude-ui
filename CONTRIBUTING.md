# Contributing

How to run claude-ui from source, and where things are.
What the app holds to, and what a change is checked against, is in [docs/principles.md](docs/principles.md); how it is built is in [docs/architecture](docs/architecture/README.md), a file per area.

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
Which of them a change needs is in [the architecture notes](docs/architecture/build-and-checks.md#which-checks-a-change-needs).

To produce installable builds: `npm run dist:linux`, and `npm run dist:mac` on a Mac.
Artifacts land in `release/`.
Tagging a version runs CI's checks on it, then builds both on CI and publishes them as a release.

## Project layout

- `src/main` — the Electron main process: `main.ts` starts the app and `paths.ts` decides where its data lives; the rest is by area, the same areas as the architecture notes: `sessions/` (reading Claude Code's sessions, the app's metadata about them, their PRs), `status/` (the status hooks and the needs-you types), `pty/` (the pseudo-terminals claude and the shells run in), `panels/`, `config/` (the config folder and settings), `logs/` (the log and the usage record), `window/`, `platform/`, and `files/` (how the app writes its own files).
- `src/preload` — the bridge the renderer uses to reach the main process.
- `src/renderer` — the window UI: `renderer.ts` starts it, `ui/` holds the building blocks every surface draws (menus, tooltips, the terminal view, a tab), `dialogs/` the dialogs and Settings, `status/` a session's dots and marks, `window/` the window's own parts, and `rules/` the pure rules the rest asks; everything in those folders sits below the panels and never imports from them.
- `src/renderer/state` — the store the window's surfaces share, and what more than one of them reads from it.
- `src/renderer/panels` — the layout tree and the panel types: `panels/types/sessions` (the sidebar), `panels/types/claude` (the Claude tabs), and the others.
- `src/shared` — what both sides use: `types.ts` and `panels.ts` at its root, which every side reads, then `sessions/`, `status/` and `config/` by area, the same as `src/main`, and `helpers/` for small pure helpers; main's rules the window's checks answer with live here too.
- `test/` — the tests: unit tests in `test/unit/`, mirroring `src/`, the rules every comment and doc keeps in `test/text/`, and the window's checks in `test/renderer/`, filed by the panel or surface they check.
- `docs/` — architecture and design notes.
