# claude-ui — start here

This file loads into every Claude session automatically. `README.md` and `docs/` do not, so this is the entry point.

## What this is

A desktop app (Electron + TypeScript, runs on WSL via WSLg) for running and tracking several Claude Code sessions from one window: a session list read from `~/.claude`, pin/group, an embedded real `claude` terminal, and per-session waiting/done cues.
Same-folder sessions by design, never a worktree per session.

## Read before working

- `README.md` — overview, current status and roadmap, how to run.
- `docs/architecture.md` — environment, process model, build, planned terminal and cues.

Read both at the start of any change. The roadmap in `README.md` is the source of truth for what is done and what is next; keep it current as milestones land.

## Working in this repo

- Node is pinned in `mise.toml`. If the shell has no mise activation: `mise exec -- npm ...`.
- Runs under WSL via WSLg; launch needs `--no-sandbox` (the `start` script sets it).
- Two tsconfigs build the app: `tsconfig.main.json` (main + preload, NodeNext/CommonJS) and `tsconfig.renderer.json` (renderer, ESNext/bundler). TypeScript 7 removed `moduleResolution: node`; don't reintroduce it. A third, `tsconfig.test.json`, is read only by the linter.
- `typescript` in `package.json` is the TypeScript 6 API package on purpose, because typescript-eslint needs a JS API that TypeScript 7 lacks; `tsc` is TypeScript 7, installed as `@typescript/native`. Keep them as two entries (see `docs/architecture.md` § Build).
- `npm run lint` is ESLint with type-aware rules, and CI runs it. Why each rule is off or tuned is written beside it in `eslint.config.mjs`.
- `node-pty` (M2) is a native module — rebuild against Electron's ABI after install.

## Conventions

- Same-folder sessions; never spawn a git worktree per session.
- Stage new files as you create them; leave commits to the user.
- `README.md` and `docs/` are human-facing and must not mention this file or `.claude/`. This file may point at them and at code.
- Local-only content stays out of git: plans in `.plan/`, personal notes in `CLAUDE.local.md` (both gitignored globally).
- UI conventions (menu/popover active state, the folder/project/group vocabulary, etc.) live in `docs/architecture.md` § UI conventions.
- **`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com); `UPGRADING.md` holds anything the reader must DO.** Entries go under `### Added`, `### Changed` or `### Fixed` — never a `chore` or `refactor` heading, which are commit categories and have no audience here.
  **Versions run newest-first** (the standard's own rule, and what puts `## Unreleased` where it is edited), but **entries inside a version run OLDEST-first**, in the order the work happened — the standard says nothing about that, and a release reads as what was done to it rather than as a ranking. An internal change with no visible effect gets no entry at all; if it fixed something visible on the way, the entry is that visible thing.
  **One line per entry.** Say what changed, and add a clause of why only where it changes what the reader should do. The reasoning belongs in `docs/architecture.md`, which is where someone goes to understand the code — a changelog is read while deciding whether to update.
  A version's section is what `release.yml` publishes as its release notes, extracted by matching `^## <version>`, so the `###` subsections pass through untouched. An empty section fails the release rather than publishing one that says nothing.
  `UPGRADING.md` lists ONLY versions that need an action, newest first, so its headings are the answer to "which releases need something from me" — a version absent from it installs straight over the last. Symfony's file-per-version (`UPGRADE-6.1.md`) was considered and rejected at this size: it splits because it maintains several branches at once and each guide runs to hundreds of lines. SPLIT WHEN EITHER OF THOSE BECOMES TRUE — one version's notes outgrow a screen, or two release lines are maintained together — and not before.
- **One implementation per behaviour, in every language here — not just CSS.** Anything that exists on more than one surface, or is done in more than one place, is one class/function/helper with modifiers or parameters for the real differences. Parallel copies drift, and they drift silently, between the times anyone is looking at them. The test: **a comment saying "match X exactly", "same as Y", or "for the same reason as Z" is a bug report against the code** — the relationship is being held together by whoever remembers it. Extract it instead. Do it as soon as there is room rather than waiting until you happen to be in the file, which is after the damage. Land each extraction as its own change, so a regression has something to bisect.
- **One BEHAVIOUR too, not just one implementation.** Where the same question is answered on more than one surface — what order things sit in, what a control does, when something repaints — the default answer is the same answer everywhere. A difference has to be a DECISION somebody took and wrote down, not something that emerged. The tab bar ordered projects by whichever it met first while the sidebar and the strip used the order the user set; nobody chose that, it was just what the code happened to do, and it read as a bug the moment anyone compared them. Deliberate deviations are fine and should say so where the code is: pins float in the session list and not in the live strip, because a pin says where a session belongs in the LIST. When you touch one surface, ask what the others do about the same question, and either match them or record why not.
