# claude-ui — start here

This file loads into every Claude session automatically.
`README.md`, `CONTRIBUTING.md` and `docs/` do not, so this is the entry point.

## What this is

A desktop app (Electron + TypeScript, runs on WSL via WSLg) for running and tracking several Claude Code sessions from one window: a session list read from `~/.claude`, pin/group, an embedded real `claude` terminal, and per-session waiting/done cues.
Same-folder sessions by design, never a worktree per session.

## Read before working

- `README.md` — what the app does, in short, and how to install it; `docs/guide/` — how to use it, by area; `CONTRIBUTING.md` — running it from source and the project's layout.
- `docs/architecture/` — how the app is built, a file per area; its `README.md` lists them.
- `docs/principles.md` — what the app holds to: Claude Code as the source of truth, the core against extensions, shaping by the user, observing rather than deciding, no imposed workflow.

Read all three at the start of any change, and of `docs/architecture/` the files for the areas the change touches.
Check a change against `docs/principles.md`, and where it would go against a principle, say so and ask, rather than bend the principle or the change quietly.
`docs/guide/` describes the app as it is, and `README.md` § What it does sums it up; keep both current as features land.

## Working in this repo

- Node is pinned in `mise.toml`.
  If the shell has no mise activation: `mise exec -- npm ...`.
- Runs under WSL via WSLg; launch needs `--no-sandbox` (the `start` script sets it).
- Two tsconfigs build the app: `tsconfig.main.json` (main + preload, NodeNext/CommonJS) and `tsconfig.renderer.json` (renderer, ESNext/bundler).
  TypeScript 7 removed `moduleResolution: node`; don't reintroduce it.
  A third, `tsconfig.test.json`, covers the tests, which all live under `test/` — unit tests in `test/unit/`, mirroring `src/`, the rules every comment and doc keeps in `test/text/`, and the window's checks in `test/renderer/` — so a new test goes there, never beside its module: the linter reads it and `npm test` type-checks it.
- `npm run test:renderer` builds, then runs the window's checks: Playwright on the built renderer, headless, with a typed stand-in for the bridge (`test/renderer/support/bridge.ts`).
  A check goes under the panel type it checks (`test/renderer/panels/types/<type>/`), or `panels/layout/` for the layout tree.
  Nothing goes on screen and the running app is not touched, so it is the way to check a renderer change before anyone relaunches.
  A check that reaches a bridge call the stand-in does not model fails naming it; model the call there.
  See `docs/architecture/build-and-checks.md` § The window's checks.
- `typescript` in `package.json` is the TypeScript 6 API package on purpose, because typescript-eslint needs a JS API that TypeScript 7 lacks; `tsc` is TypeScript 7, installed as `@typescript/native`.
  Keep them as two entries (see `docs/architecture/build-and-checks.md` § Build).
- `npm run lint` is ESLint with type-aware rules, and CI runs it.
  Why each rule is off or tuned is written beside it in `eslint.config.mjs`.
- A change that takes a file past `max-lines` splits that file first, along the areas of `docs/architecture/`, as a commit of its own that changes no behaviour, before the change itself goes in.
  Put a reason at the file's top instead only when its parts truly belong together, and say so in the commit proposal; never name a new file for no concept (`logic`, `utils`), and split a name of several words with dashes (`terminal-shell.ts`, never `terminalshell.ts`).
  A test file is split by the module or behaviour it covers, never trimmed: no test is dropped or merged to make a file fit.
  A change that takes a function past `max-lines-per-function` splits that function first, as a commit of its own that changes no behaviour, along the steps it takes, into functions named for what each does.
- Checks run once per change set, when it is complete, never after each edit; while working, run only the file at hand: `npx vitest run <file>`, or `npm run build` and then `npx playwright test -c test/renderer <file>`.
  The floor is the pre-commit hook (`.pre-commit-config.yaml`, installed by `mise install` along with pre-commit, or by `pre-commit install --allow-missing-config` where pre-commit was there already): stage the change and run `pre-commit run`, which runs on the staged files whatever fast checks they reach, the build, the linter, the tests' type-check, fallow, and every unit test and text rule, in about forty seconds, more when a config change has it lint every file.
  The commit runs it again, so a change that skipped it is still held to it; never commit with `--no-verify` or `SKIP` to get past it.
  Beyond the floor, a change needs only what is listed in docs/architecture/build-and-checks.md § Which checks a change needs; nothing means nothing: never a heavier check because a change felt risky.
  Window checks, for a change the window can show: the files that changed, and the files that exercise what changed, found by grepping `test/renderer` for the labels, ids, class names and selectors the change touches; a hit inside `test/renderer/support/` means every check that calls that helper.
  A change to comments alone in a script needs no window checks once `npm run comments:prove` passes; one the proof fails is a change to code.
  The whole of `npm run test:renderer` runs only for a change whose reach cannot be listed that way: `src/shared`, the store and its state, the layout tree, a renderer module many others import (`rules/sessions.ts`, `svg.ts`, `tooltip.ts`, `dom.ts`), a stylesheet many surfaces draw such as `base.css`, `test/renderer/support/` itself, dependencies, a tsconfig or a tool's config.
  A change to how the session list draws, or to when the store tells its readers, also runs `npm run test:perf`, the performance budgets, which never runs in CI (`docs/architecture/build-and-checks.md` § The performance checks); a slower result under a loaded machine says so in its output.
  Say in the commit proposal what ran beyond the floor; CI runs every check on every push to `main` and every pull request, so a narrow choice that missed something is still caught there.
  Never side by side: the window's checks load the whole machine, so together they took longer than in a row and pushed unit tests past their timeout.
  After a failed run of the window's checks, never the whole suite again for each fix: `npm run build` and then `npx playwright test -c test/renderer --last-failed` rerun what failed or never started, until it passes, and then what was chosen once more; a check cut off mid-run, as by Ctrl+C, is not rerun.
  `--last-failed` reads `test-results/.last-run.json`, written by the last run in this checkout to finish, another session's included; while another session's run is under way there is none, and it runs everything.
- A fix to behaviour starts with a check that fails without it: a window check where the window shows the bug, a unit test where main or a pure function does.
  The check lands with the fix, and an area without checks gets one when it is next touched.
- `node-pty` (M2) is a native module — rebuild against Electron's ABI after install.
- The app's own data in its config folder (`meta.json`, `status/`, `panel-data/`) changes only through the app, never through a session's script, even one reusing the app's own functions: the app merges a partial update into what it holds, and a script writing the result as the whole file loses every field it did not return, as one did on 2026-11-08, wiping the groups, the project order and the sidebar's state.
  A cleanup the app has no action for is done in the app by the user, or becomes an app feature first.

## Conventions

- Same-folder sessions; never spawn a git worktree per session.
- Stage new files as you create them; leave commits to the user.
- `README.md`, `CONTRIBUTING.md` and `docs/` are human-facing and must not mention this file or `.claude/`.
  This file may point at them and at code.
  Nor do they tell Claude how to work: how a session should work here goes in this file or `.claude/`, even where a doc covers the same ground for people.
  A decision they or a code comment record says when and why, never who asked for it: "(decided 2026-10-20)" with the reason in plain words, not "(user, 2026-10-20)" or a quote from a chat.
  A new decision goes into `docs/decisions/` as the next number, with its line in that folder's index, and the architecture notes state what the app does and link to it rather than carry the reasoning.
  A decision it replaces, whole or in part, is marked in the same change, in the index and under its title, as that folder's `README.md` says, and is otherwise left as written.
  `test/text/claude-config.test.ts` holds them to both of the patterns it can see.
- Local-only content stays out of git: plans in `.plan/`, personal notes in `CLAUDE.local.md` (both gitignored globally).
- UI conventions (menu/popover active state, the folder/project/group vocabulary, etc.) live in `docs/architecture/ui-conventions.md` § UI conventions.
- A module's stylesheet sits beside it and is imported by it; a rule several modules draw goes in a stylesheet of its own beside what owns it, or in `base.css` when nothing does, and is never copied into each.
  Moving a rule between files is checked with the style capture.
  See `docs/architecture/ui-conventions.md` § UI conventions.
- **`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com); `UPGRADING.md` holds anything the reader must DO.**
  Entries go under `### Added`, `### Changed` or `### Fixed` — never a `chore` or `refactor` heading, which are commit categories and have no audience here.
  **Versions run newest-first** (the standard's own rule, and what puts `## Unreleased` where it is edited), but **entries inside a version run OLDEST-first**, in the order the work happened — the standard says nothing about that, and a release reads as what was done to it rather than as a ranking.
  An internal change with no visible effect gets no entry at all; if it fixed something visible on the way, the entry is that visible thing.
  **One bullet per entry, one sentence per line**: a second sentence goes on the next line, indented under the bullet, and the release notes show it on a line of its own too, since GitHub renders a line break in them.
  Say what changed, and add a clause of why only where it changes what the reader should do.
  The reasoning belongs in `docs/architecture/`, which is where someone goes to understand the code — a changelog is read while deciding whether to update.
  A version's section is what `release.yml` publishes as its release notes, extracted by matching `^## <version>`, so the `###` subsections pass through untouched.
  An empty section fails the release rather than publishing one that says nothing.
  A release is cut with the `release` skill (`/release <version>`), which first checks the notes, the docs and the text in the code against the code since the last tag.
  `UPGRADING.md` lists ONLY versions that need an action, newest first, so its headings are the answer to "which releases need something from me" — a version absent from it installs straight over the last.
  Symfony's file-per-version (`UPGRADE-6.1.md`) was considered and rejected at this size: it splits because it maintains several branches at once and each guide runs to hundreds of lines.
  SPLIT WHEN EITHER OF THOSE BECOMES TRUE — one version's notes outgrow a screen, or two release lines are maintained together — and not before.
- **One implementation per behaviour, in every language here — not just CSS.**
  Anything that exists on more than one surface, or is done in more than one place, is one class/function/helper with modifiers or parameters for the real differences.
  Parallel copies drift, and they drift silently, between the times anyone is looking at them.
  The test: **a comment saying "match X exactly", "same as Y", or "for the same reason as Z" is a bug report against the code** — the relationship is being held together by whoever remembers it.
  Extract it instead.
  Do it as soon as there is room rather than waiting until you happen to be in the file, which is after the damage.
  Land each extraction as its own change, so a regression has something to bisect.
- **One BEHAVIOUR too, not just one implementation.**
  Where the same question is answered on more than one surface — what order things sit in, what a control does, when something repaints — the default answer is the same answer everywhere.
  A difference has to be a DECISION somebody took and wrote down, not something that emerged.
  The tab bar ordered projects by whichever it met first while the sidebar used the order the user set; nobody chose that, it was just what the code happened to do, and it read as a bug the moment anyone compared them.
  Deliberate deviations are fine and should say so where the code is: pins float in the session list and not in the tab bar, because a pin says where a session belongs in the LIST.
  When you touch one surface, ask what the others do about the same question, and either match them or record why not.
- **Panels and panel types are made to be shared, so both lean to configurable.**
  A type decides for itself what its panel shows and what a press on it does: a type offers an option for anything its user may want otherwise, and the list contract offers a field for anything a type may want otherwise, each with a default, rather than the answer being fixed in the app or the script.
  The built-in panels (`sessions`, `claude`) are the app's, and are shaped only through settings and their options.
