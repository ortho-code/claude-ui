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
A change meant to touch only comments is proved to with `npm run comments:prove [-- <ref>]` (`test/tools/comments-only.ts`): every file changed since the ref, HEAD unless named, must be the same as it was there once its comments are dropped (TypeScript and JavaScript printed back from their parse and compared token by token, CSS with its comments taken out, markdown rendered), and a file of another kind, a new one, a deleted one or a renamed one fails it.
A directive comment is not dropped, since the tool that reads it takes it as code: ESLint's, TypeScript's, esbuild's annotations (`@__PURE__` and its kind, anywhere in a comment) and the legal comments it keeps in the bundle, and Vitest's environment, must each stay as they were, between the same two tokens and the same line breaks from each; one about its own line, an `eslint-disable-line`, keeps that line too, and one about the line below it, such as a `@ts-expect-error`, everything up to the next line that is neither blank nor a `//` comment.
Passing it is still no reason to skip the linter, whose rules read other comments too (§ Which checks a change needs).

## The window's checks

Every test is under `test/`, so `src/` is only what ships.
`npm test` is the unit tests: vitest, in `test/unit/`, which mirrors `src/` folder for folder, fast enough to run all the time.
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

## Which checks a change needs

What a commit runs follows from what it changed, since most of the time goes on the window's checks, and most changes cannot reach them.
The table is the widest each folder can need; a small change runs only the checks that can reach it, such as the window checks that find the label or class name it touches, and the whole of a suite only when its reach cannot be listed that way ([decided 2026-10-29](../decisions/0136-a-commit-runs-only-the-checks-that-can-reach-it.md)).

| What changed | The widest it needs |
|---|---|
| Only `.md` files | `npm test` |
| Only comments in scripts, which `npm run comments:prove` passes | `npm run comments:prove`, then `npm run build`, `npm test`, `npm run lint` |
| `src/main`, `src/preload`, `test/unit`, `test/text`, `test/tools`, `scripts/` | `npm run build`, `npm test`, `npm run lint` |
| `src/renderer`, `src/shared`, `test/renderer`, `assets/` | all four: `npm run build`, `npm test`, `npm run lint`, `npm run test:renderer` |
| `package.json`, `package-lock.json`, a `tsconfig*.json`, a tool's config, `mise.toml` | all four |

A change across rows runs what each of its rows lists.
The first takes about ten seconds, the next two about half a minute, and the last two up to two minutes, most of it the window's checks.

A doc needs more than the text rules where a unit test holds it to the code: the variables `docs/panel-types.md` names, the icon names in `docs/guide/layout.md`; those tests name the doc they read, so a search of `test/unit` for its file name finds them, and `npm test` covers every one at once.
A comment still reaches the linter (one that fills an empty block, a `// falls through`, a `@deprecated` tag), the compiler (what a `@ts-expect-error` covers) and the text rules (a wrapped line), but not the window: once the proof passes, the bundled code is the same, its directives included, and only the source map beside it differs.
A comment change the proof fails, a directive's among them, is a change to code, and goes by the row of its folder.
So does a stylesheet's comment: the proof takes every `/* … */` out as a space, which is wrong between two selectors, where a comment leaves them joined, and inside a string, where it is no comment at all.
Main and the preload reach the window's checks only through the build, which their row runs already: the checks load the built renderer, with a stand-in for the bridge, and import nothing but `src/shared` and `src/renderer`, neither of which imports `src/main` or `src/preload`.
`src/shared` is built into main and into the window alike, so it runs everything.
A workflow, `electron-builder.yml` and the shell script in `build/` are read here only by the text rules, for their comments, and the macOS entitlements file by nothing; CI's next run, or a release, is where they are tried.

CI runs all four on every push to `main` and every pull request, whatever changed, so a commit that ran too few is still caught, after the push rather than before it.
While working on one thing, run only its file: `npx vitest run <file>`, or `npm run build` and then `npx playwright test -c test/renderer <file>`; the choice above is for the commit.
