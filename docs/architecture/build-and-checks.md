# Build and checks

## Build

Two TypeScript projects, because the two sides need different module systems:

- `tsconfig.main.json` — main and preload.
  `NodeNext` module and resolution, emitted as CommonJS (the package has no `"type": "module"`), so `require` and `__dirname` work.
- `tsconfig.renderer.json` — renderer.
  `ESNext` module with `bundler` resolution and the DOM libs.

TypeScript 7 removed the old `moduleResolution: "node"`, so both projects use the newer values above.
`src/shared` holds types and pure helpers, and each side compiles its own copy, so no module is shared at runtime.
The renderer's project compiles all of it without Node's types, so a module there that reached for Node fails the build even when the renderer never imports it.

**`typescript` in `package.json` is TypeScript 6, and `tsc` is TypeScript 7.**
TypeScript 7 has no JavaScript API yet, and typescript-eslint, which lints with the compiler's own type information, cannot run without one.
So the `typescript` name holds `@typescript/typescript6`, the package Microsoft publishes for tools in this position, and the compiler the build runs is installed as `@typescript/native`, which is what provides the `tsc` command.
The alias goes once typescript-eslint's supported TypeScript range includes 7.

A third project, `tsconfig.test.json`, covers the test files, which are in neither build project.
The linter reads it, because a type-aware rule needs a project for every file it reads, and `npm test` type-checks it before running anything, because vitest strips a test's types without checking them.
It lets an import name a `.ts` file, which Node needs to run a script under `test/` straight from its source, as `npm run comments:prove` does with the comment walker it shares with the prose rule.

`noUncheckedIndexedAccess` is on, so an index into an array or a record reads as possibly missing, and the code says why it is not: a check, or a `!` where the lines just before guarantee it.
The test project turns it off: a test that indexes past the end fails anyway, and the source files it pulls in are checked with it on by the build projects.

**Prose is one sentence per line**, in a comment or in a doc: no sentence goes on in the next line, so the raw text reads as the rendered one does, and no line holds two, so an edit changes only the lines of the sentences it touches.
A test reads every comment and doc paragraph in the TypeScript, JavaScript, CSS, YAML, shell, TOML and markdown files git does not ignore, a new one not yet added included, and fails on a wrapped line or a line of two sentences, naming it (`test/text/prose.test.ts`); what it leaves out (a fence, a table, a tag, an indented sample, and for wrapping a list and a comment after code) is spelled out in it.
Another reads every link in those markdown files and fails on one that leads to no file, or into a markdown file to no heading, by the anchors GitHub gives headings (`test/text/links.test.ts`).
A third holds what a release reads to one version: `package.json` and both places in `package-lock.json`, `## Unreleased` first in the changelog with that version's section below it, and that section found and holding entries when `release.yml`'s own extraction program runs on it (`test/text/release.test.ts`).
A change meant to touch only comments is proved to with `npm run comments:prove [-- <ref>]` (`test/tools/comments-only.ts`): every file changed since the ref, HEAD unless named, must be the same as it was there once its comments are dropped (TypeScript and JavaScript printed back from their parse and compared token by token, CSS with its comments taken out, markdown rendered), and a file of another kind, a new one, a deleted one or a renamed one fails it.
A directive comment is not dropped, since the tool that reads it takes it as code: ESLint's, TypeScript's, esbuild's annotations (`@__PURE__` and its kind, anywhere in a comment) and the legal comments it keeps in the bundle, and Vitest's environment, must each stay as they were, between the same two tokens and the same line breaks from each; one about its own line, an `eslint-disable-line`, keeps that line too, and one about the line below it, such as a `@ts-expect-error`, everything up to the next line that is neither blank nor a `//` comment.
Passing it is still no reason to skip the linter, whose rules read other comments too (§ Which checks a change needs).

**A file has a size** ([decided 2026-11-11](../decisions/0203-a-file-past-its-size-is-split-or-says-why-not.md)): the linter fails a source file of more than 400 lines of code and a test file of more than 700, blank lines and comments not counted (`max-lines` in `eslint.config.mjs`).
One past it is split along the areas it serves, or carries the reason it belongs together at its top, after an `eslint-disable max-lines --`.
A source function has a size too ([decided 2026-11-11](../decisions/0207-a-function-past-its-size-is-split-or-says-why-not.md)): more than 80 lines of code fails, and one past it is split along the steps it takes, or says why it belongs together above it, after an `eslint-disable-next-line max-lines-per-function --`; a test is left out, since a `describe` holds all its tests in one function.
A test file past it is split by the module or behaviour it covers, never trimmed: no test is dropped or merged into another to make it fit.
Every suppression gives its reason that way (`test/text/suppressions.test.ts`), and no source file is named for no concept, such as `logic` or `utils` (`test/unit/names.test.ts`).
A name of several words separates them with a dash, `terminal-shell.ts` ([decided 2026-11-11](../decisions/0204-a-file-name-of-several-words-is-kebab-case.md)); the same test file refuses a capital or an underscore in any file or folder name under `src/` and `test/`, and words run together are for review to catch.

**Nothing goes unused and nothing is copied** ([decided 2026-11-11](../decisions/0205-fallow-gates-ci-for-unused-and-copied-code.md)): `npm run fallow` fails on a file, export or dependency that nothing uses, on a block of code that appears twice, and on an import across the layers ([Processes](processes.md#processes)), and CI runs it after the linter.
It is fallow, set up in `.fallowrc.jsonc`, with the reason for each setting beside it; it follows calls through types, from all three TypeScript projects.
Something kept on purpose says so in a `fallow-ignore` comment with its reason, as an `eslint-disable` does.

## The window's checks

Every test is under `test/`, so `src/` is only what ships.
`npm test` is the unit tests: vitest, in `test/unit/`, which mirrors `src/` folder for folder, fast enough to run all the time.
The tools the checks are made with have theirs in `test/unit/tools/`, such as the style compare's reading of a capture.
It also runs the rules every comment and doc keeps, in `test/text/`, which test no module and so mirror nothing; `npm run test:text` runs them alone, in seconds.
`npm run test:renderer` checks the window itself: it builds, then Playwright loads the built `dist/renderer` in a headless Chromium, a fresh page per check, with nothing on screen and no main process (`test/renderer/`).
It is kept out of `npm test` so that one stays fast; CI runs both, and a failed check leaves a trace to download from the run.
A release runs CI's own workflow on its tag before building anything (`release.yml` calls `ci.yml`), so a tag on a commit that fails a check is never built.
The page is served by answering its requests from `dist/renderer` on a made-up origin rather than from a server, because module scripts do not load from `file://`.

The checks are filed the way the window is made of panels: a panel type's under `test/renderer/panels/types/<type>/` (the `claude` panel's split into `terminals/`, `tab-bar/` and `history/`), the layout tree's under `panels/layout/`, anything that is not a panel under its own name (`settings/`), and what they all use under `support/`.
It is the unit tests' rule too — a test is found where the thing it tests lives — applied to what the checks test, which is the window as its panels draw it rather than one module.
The built-ins are filed the same way, since each is a type drawn by its own modules ([§ The app's own surfaces are panels](panels.md#the-apps-own-surfaces-are-panels)).

`window.claudeUi` is a stand-in (`test/renderer/support/bridge.ts`) typed as the bridge, `ClaudeUiApi`: a call added, renamed or reshaped fails the type check there, instead of leaving a check passing against an API the app no longer has.
It answers from a fixture of plain data (`fixture.ts`), by default a first run with one session and no layout file, and records every call, so a check can assert on what the window sent.
A call it does not model rejects with its own name, and every check fails on anything thrown or logged as an error in the page, so a check that strays onto unmodelled ground fails loudly rather than running on an answer nobody held against main.
The stand-in also writes such a call down, and the check fails on it at the end whether or not anything was thrown, since the window catches some refusals and turns them into a toast, as a delete's does; a check of its own, expected to fail, holds that gate (`test/renderer/harness/`).
A check that needs such a call models it there, from what main does: where main's answer involves no decision of its own, as a plain answer, and where it does, through main's own function moved into `src/shared` for both (`readFrom` for the history's later reads, `defaultUi` for a first run, `settingsView`, `settingProblem` and `fileChanges` for the settings over the fixture's `settings.json`, `resolvePathIn` and `pathProblem` for a path option's check, with a table of what is on disk in place of main's look at it, which counts the folders the listing names and the one the folder picker answers as there unless it says otherwise, and which also answers whether a start's folder is there, refused as main refuses it, `togglePinned`, `finishedFrom`, `clearedFinished`, `markedNeedsYou`, `clearedNeedsYou` and `withText` for a session's marks and `purgedSession` for all a delete forgets, and `grouping.ts`'s rules and `withText` again for where sessions sit — a project's name, its place and the seeding of it, and its groups — and `withLink` for a session a panel's row started, kept in the fixture so a later read sees the change), so that no rule of main's is kept in two places.
A rule that needs Node is handed what it needs, since the page has no Node: `resolvePathIn` takes the `join` and `resolve` it calls, main hands in Node's `path`, and the stand-in a copy (`support/posix.ts`) that a unit test holds to Node over a fixed table and a few thousand generated paths, so Node decides main's paths and the copy is test code.

A check gets no retries: one that passes on a second try is a flake, and a gate that retries it away teaches everybody to ignore it.
The checks run in one time zone wherever they run, the page and the checks' own code alike (`playwright.config.ts`), since a day is the local day and a check's "today" otherwise fell on two days in some zones; it is not UTC, where local time and UTC are the same and code that reads one for the other could never show.

**`test/renderer/styles/` is a tool rather than a check, for moving CSS without changing what anything looks like.**
It is skipped unless `STYLE_SNAPSHOT` names a folder; then it puts the window in a set of states and writes every element's computed style there, one file per state, at rest and with `:hover` and `:focus-visible` forced on each control, with a picture of each state beside it, so that a capture before a change and one after can be compared (`npm run styles:compare -- <before> <after>`).
It exists because a stylesheet split across files is read in another order, and two rules of equal specificity then swap winners with nothing in the CSS's own diff to show it.
The picture is for what styles cannot say: which of two overlapping elements paints on top, which follows from their order in the page; a picture alone would miss every hover, everything off screen, and which property changed.
Forced states go through the DevTools protocol rather than the mouse, since a real hover runs the page's handlers, and a submenu opening would change what is captured; two captures of one build are identical, which is what makes an empty comparison mean something.
A jump's flash is let end before a state is captured: it takes itself off on a timer the capture cannot hold, so a capture that caught it depended on how fast it ran, and once in about ten it did not.
A hidden tooltip is taken out for the same reason: a slow run can show and hide one between two steps, leaving behind a hidden `#tooltip` that a fast run never made, while a shown one is captured, and a state of its own holds one up.
The known exceptions are a few anti-aliased corners one shade apart from one run to the next; for the first found, the Settings button's, that is Chromium's drawing (below).
That one is two pixels of `busy.png` (x 122, y 38-39), in between one capture in six and one in three: the bottom-left corner of the Settings button's border, which sits at a fractional position (x 120.6).
Of three captures taken on 2026-10-14, one differed from the other two by the same two pixels in `loupe.png`, beside two at x 160 at the same height, the bottom-left corner of the header button after it; and another by five pixels down the left edge of a tab's top-left corner in `history.png` (x 331, y 10-14) and one beside them (x 332, y 10); neither looked into further.
Two captures of one build have also differed by 18 pixels of `settings.png`, one shade apart, at the Settings button's border (x 122-152, y 12-40), one capture in four on 2026-10-15 and again on 2026-10-26; not looked into further.
The Settings button's corner is none of the window's doing: the layout and every computed style are the same either way, no tooltip is up, removing every animation or switching the raster path (`--disable-gpu`, `--disable-gpu-rasterization`) leaves it, and with the button moved to a whole pixel it goes (measured 2026-10-01).
The comparison lists them, as it lists every pixel that differs, rather than excusing them, and one capture alone is no baseline, so a change is compared against two of the build before it.
The comparison sorts each state's lines, and takes a map of the classes a change renames (`{ "old": "new" }`), applied to the before-capture's element keys only, so a pure rename compares empty.

## The performance checks

`npm run test:perf` holds the window to its performance budgets: it builds, then Playwright loads the built `dist/renderer` on the window checks' own harness and stand-in (`test/perf/`), with a list of 1,000 sessions, and times what the list does.
Each check runs twice, as two Playwright projects: at the machine's own speed, and with Chromium's CPU slowed four times over, which stands in for a slower laptop.
A key in the query field is timed to the second frame after it (`query-field.spec.ts`); a status change, twenty at once, and a session renamed in the listing are timed by their longest task, the longest the window went without a turn for anything else (`live-updates.spec.ts`), and so is the minute's clock, over a real minute, since faking the page's clock would also fake the time the checks read.
Every check prints a line per event with its median, its 95th percentile and its budget, or that it is reported only, so a pass also says by how much, and holds the 95th percentile to the budget where there is one; a listing change and the minute's clock are reported only.

It runs on its own, never in `npm test`, `npm run test:renderer` or CI ([decided 2026-11-18](../decisions/0235-the-performance-checks-run-on-their-own.md)): a timing on a shared runner flakes, and a gate made to pass there with retries or wide margins would hold nothing.
So it runs one check at a time, and reads the machine's load once it has measured: above half the cores, its report ends with a line saying so, and so does the failure of each budget it holds, since the slowed runs suffer most; a failure is still a failure rather than skipped, so a real slowdown is never hidden.
It does not cover main's answers, which the stand-in gives, or Electron's own window.

### The budgets

Each holds at 1,000 sessions, about one and a half times the list the budgets were set on, so they still hold as the list grows, and at the machine's speed and slowed four times, since the app runs on laptops slower than the one it is built on.

| What | Budget | Held by | Last measured, 95th percentile, at its speed / slowed |
|---|---|---|---|
| A key in the query field | its frame within 50 ms, 200 ms slowed | `query-field.spec.ts` | keeping rows 32 / 199 ms; dropping rows 33 / 230; bringing rows back 85 / 379 |
| A status change, and twenty at once | no task longer than a frame, 16 ms; 8 ms of script is what the design leaves for it | `live-updates.spec.ts` | 5.8 / 103 ms; 3.9 / 29 |
| A session's listing changing | measured, not held | `live-updates.spec.ts` | 34 / 168 ms |
| The minute's clock | measured, not held | `live-updates.spec.ts` | 34 / 193 ms, one sample |
| Evaluating a view's query, sets and sort, without the page | 5 ms | nothing yet: the query language does not exist yet | |
| A plugin that adds links to sessions | runs at most once a minute, at most two at once, cut off after 60 s with its last links kept | nothing yet: no such plugin exists yet | |
| The sessions file a panel's run is given | at most 1 MB and 10 ms to build | nothing yet | |

Last measured 2026-11-19, at a load of about 10 on 24 cores; the slowed runs' 95th percentiles vary most from run to run, and quieter runs that day measured bringing rows back at 167 ms and a status change at 24.

## Which checks a change needs

Every commit runs the fast checks itself, through a [pre-commit](https://pre-commit.com) hook that `mise install` installs along with pre-commit, shared by every worktree of the clone and skipped in one whose branch has no config yet: `.pre-commit-config.yaml` lists them, each with the files that start it ([decided 2026-11-25](../decisions/0273-every-commit-runs-the-fast-checks.md)).
On the staged files it checks YAML, TOML and JSON, merge conflict markers, large files, final newlines and line endings, and the workflows with actionlint; it runs ESLint on the staged scripts, and on every file when the linter's config, a tsconfig or `package.json` changes; and it runs the build, the tests' type-check and fallow on a change to the code, a tsconfig or `package.json`, and every unit test and text rule on any change to text.
That takes about forty seconds, and `pre-commit run` runs it on what is staged without committing.
All the unit tests run rather than a choice of them, since some read a doc rather than import a module, and a choice by imports would miss those.

Beyond that, a change needs only the checks below, and the window's checks only as far as a change can reach them ([decided 2026-10-29](../decisions/0136-a-commit-runs-only-the-checks-that-can-reach-it.md)):

| What changed | Beyond the hook |
|---|---|
| `src/main` other than `config/jsonc.ts`, `src/preload`, `test/unit`, `test/text`, `test/tools`, `scripts/`, docs | nothing |
| Only comments in scripts, which `npm run comments:prove` passes | nothing |
| `src/renderer`, `test/renderer`, `assets/`, `bundled/`, `src/main/config/jsonc.ts` | the window checks that find the labels, ids, class names and selectors it touches, with `npm run build` first |
| `src/shared`, the store, the layout tree, a renderer module or stylesheet many others draw on, `test/renderer/support/`, `package.json`, `package-lock.json`, a `tsconfig*.json`, a tool's config, `mise.toml` | the whole of `npm run test:renderer` |
| `test/perf`, or how the session list draws, or when the store tells its readers | `npm run test:perf` (§ The performance checks) |

A change across rows runs what each of its rows lists, once, when the change is complete; the whole of `npm run test:renderer` takes about two and a half minutes.

A comment still reaches the linter (one that fills an empty block, a `// falls through`, a `@deprecated` tag), the compiler (what a `@ts-expect-error` covers) and the text rules (a wrapped line), but not the window: once the proof passes, the bundled code is the same, its directives included, and only the source map beside it differs.
A comment change the proof fails, a directive's among them, is a change to code, and goes by the row of its folder.
So does a stylesheet's comment: the proof takes every `/* … */` out as a space, which is wrong between two selectors, where a comment leaves them joined, and inside a string, where it is no comment at all.
Main and the preload reach the window's checks through the build, which the hook runs, and in one place directly: the stand-in reads the needs-you rules the app ships, in `bundled/needs-you/`, with main's own `src/main/config/jsonc.ts`.
Otherwise the checks load the built renderer, with a stand-in for the bridge, and import nothing but `src/shared` and `src/renderer`, neither of which imports `src/main` or `src/preload`.
`src/shared` is built into main and into the window alike, so it runs everything.
A workflow, `electron-builder.yml` and the shell script in `build/` are read here only by the text rules, for their comments, and the macOS entitlements file by nothing; CI's next run, or a release, is where they are tried.

CI runs all five on every push to `main` and every pull request, whatever changed, so a commit that ran too few is still caught, after the push rather than before it.
While working on one thing, run only its file: `npx vitest run <file>`, or `npm run build` and then `npx playwright test -c test/renderer <file>`; the choice above is for the commit.
