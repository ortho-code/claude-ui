# claude-ui — start here

This file loads into every Claude session automatically. `README.md` and `docs/` do not,
so this is the entry point.

## What this is

A desktop app (Electron + TypeScript, runs on WSL via WSLg) for running and tracking
several Claude Code sessions from one window: a session list read from `~/.claude`,
pin/group, an embedded real `claude` terminal, and per-session waiting/done cues.
Same-folder sessions by design, never a worktree per session.

## Read before working

- `README.md` — overview, current status and roadmap, how to run.
- `docs/architecture.md` — environment, process model, build, planned terminal and cues.

Read both at the start of any change. The roadmap in `README.md` is the source of truth
for what is done and what is next; keep it current as milestones land.

## Working in this repo

- Node is pinned in `mise.toml`. If the shell has no mise activation: `mise exec -- npm ...`.
- Runs under WSL via WSLg; launch needs `--no-sandbox` (the `start` script sets it).
- Two tsconfigs: `tsconfig.main.json` (main + preload, NodeNext/CommonJS) and
  `tsconfig.renderer.json` (renderer, ESNext/bundler). TypeScript 7 removed
  `moduleResolution: node`; don't reintroduce it.
- `node-pty` (M2) is a native module — rebuild against Electron's ABI after install.

## Conventions

- Same-folder sessions; never spawn a git worktree per session.
- Stage new files as you create them; leave commits to the user.
- `README.md` and `docs/` are human-facing and must not mention this file or `.claude/`.
  This file may point at them and at code.
- Local-only content stays out of git: plans in `.plan/`, personal notes in
  `CLAUDE.local.md` (both gitignored globally).
- UI conventions (menu/popover active state, the folder/project/group vocabulary, etc.) live in
  `docs/architecture.md` § UI conventions.
