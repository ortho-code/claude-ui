# Architecture

## Environment

The app targets WSL 2 with WSLg.
The Electron app, the `claude` CLI it launches, and the `~/.claude` session store all live inside the same Linux distribution, so there is no Windows-to-WSL path translation.
WSLg shows the window.

Electron needs `--no-sandbox` under WSL; the `start` script passes it.

It runs on **X11 (Xwayland)**, the Electron default here.
Do not switch it to Wayland: with `--ozone-platform=wayland` the window paints solid white, with or without `app.disableHardwareAcceleration()`, while a bare Electron window with the same flags paints fine — so it is something about this window, and it has not been chased down.
`--ozone-platform-hint=auto` picks X11 anyway.

If **every cursor stays an arrow** — no hand over a button, no I-beam over an input — that is WSLg's pointer state stuck, not the app and not Xwayland.
Nothing in CSS or in Chromium's flags will move it (verified: every control computes `cursor: pointer` correctly).
Closing all WSLg windows and reopening clears it; so does starting and quitting any Wayland client, which cycles Weston's pointer.

## Processes

The standard Electron split, with the renderer locked down:

- **Main** (`src/main`) owns the window, reads the filesystem, and will own the PTYs.
- **Preload** (`src/preload`) exposes a small typed API on `window.claudeUi` through `contextBridge`.
  `contextIsolation` is on and `nodeIntegration` is off, so the renderer never touches Node directly.
- **Renderer** (`src/renderer`) is plain DOM, no framework yet, and talks only to the preload API.

The linter holds the split: a source file importing from another process's folder fails `npm run lint`, and code both sides need goes in `src/shared`.
So does a rule of main's that the window checks' stand-in answers with, so the stand-in runs main's own code rather than a copy of it (§ The window's checks), which is why some modules there are imported by main alone.
The tests are outside it, under `test/`, since a test may assert across the line — the launcher's flags against the reserved list, for one.
Inside the renderer it holds four more lines the same way: the two built-ins never import each other's modules, a service never imports from `panels/`, nor does `state/`, and outside `panels/types/` only the tree and the start-up (`renderer.ts`, `view-saving.ts`) import a panel type's module.
ESLint takes a rule's settings from the last block that matches a file, so each of those blocks repeats the process rule rather than adding to it (`eslint.config.mjs` says so beside them).
A unit test crosses every boundary on purpose, from inside every block, through ESLint's own API (`test/unit/boundaries.test.ts`), so a block that drops the process rule, or a pattern that misses a way of spelling a path, fails there rather than letting a crossing through.
What no lint rule here can hold, a unit test does (`test/unit/imports.test.ts`): no cycle of value imports anywhere in `src/`, read with the compiler's own parser, `import type` aside since it runs nothing.

**The window never navigates.**
Main refuses any navigation away from the app's own page and any new window (`will-navigate`, `setWindowOpenHandler`), because a page loaded there would get the preload's bridge, and the bridge runs commands.
Links leave through `shell:openExternal` instead, which accepts only http(s); the app itself never navigates, and `loadFile` is programmatic, which the event does not see.

## Reading sessions

`src/main/sessions.ts` walks `~/.claude/projects/*/*.jsonl`.
Each `.jsonl` is one session transcript with one JSON event per line.
For each file it streams the lines to pull the working directory and the first user message without loading the whole file, counts the events, and takes last activity from the file mtime.
The renderer groups the results by working directory.

**A session's worktree comes from its transcript**: the last of Claude Code's `worktree-state` records, when there is one, says whether the session entered a worktree or left it, and without one the first `cwd` does.
A session the transcript last puts in a worktree carries the worktree's name (`worktree`), and that is where a resume runs.
One that ran in a worktree and has since left it carries the name apart (`leftWorktree`), drawn as the same badge, muted, because it still did its work there; a resume runs where it is now.
Both are named the same way, so a tree removed since is still named under `<repo>/.claude/worktrees/`, where Claude Code cuts them, and goes unnamed, so unbadged, anywhere else.
The record of leaving does not always say why: in one transcript here it follows an `ExitWorktree` call, in others it is the last line, and the muted badge is true whatever the cause.
A Bash `cd` into a worktree changes the `cwd` the records carry and nothing else: Claude Code records no worktree session, and a resume runs where the session started, so it counts as neither.
Counting it was considered and rejected: any record in a worktree would badge a one-off look inside one, and a share of the records would be a threshold nothing can check.

**A session's PRs come from its transcript too**: Claude Code writes a `pr-link` record naming a PR's repository, number and page, and writes the same one again and again through a session, so each is kept once, in the order first linked (`prs`), and drawn as a mark on the row that lists them.
A record says the PR is linked to the session, not who opened it, so the mark says "linked": over one machine's transcripts (2026-10-14), 96 of the 98 PRs linked were the user's own, and the other two a colleague's that a session worked on.
A fork's transcript copies none of its parent's records, but in four of the five families there with a PR, the fork's opening records link its parent's PR afresh, so a fork tends to show its parent's PR from the start.
What a PR's state is, open or merged, is not in the record, and nothing here reads it.

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

`noUncheckedIndexedAccess` is on, so an index into an array or a record reads as possibly missing, and the code says why it is not: a check, or a `!` where the lines just before guarantee it.
The test project turns it off: a test that indexes past the end fails anyway, and the source files it pulls in are checked with it on by the build projects.

**Prose is one sentence per line**, in a comment or in a doc: no sentence goes on in the next line, so the raw text reads as the rendered one does, and no line holds two, so an edit changes only the lines of the sentences it touches.
A unit test reads every comment and every doc paragraph git tracks and fails on a wrapped line or a line of two sentences, naming it (`test/unit/prose.test.ts`); what it leaves out (a fence, a table, a tag, an indented sample, and for wrapping a list and a comment after code) is spelled out in it.
A change meant to touch only comments is proved to with `npm run comments:prove [-- <ref>]` (`test/tools/comments-only.ts`): every file changed since the ref, HEAD unless named, must be the same as it was there once its comments are dropped (TypeScript and JavaScript printed back from their parse, CSS with its comments taken out, markdown rendered), and a file of another kind, a new one or a deleted one fails it.

## The window's checks

Every test is under `test/`, so `src/` is only what ships.
`npm test` is the unit tests: vitest, in `test/unit/`, which mirrors `src/` folder for folder, fast enough to run all the time.
`npm run test:renderer` checks the window itself: it builds, then Playwright loads the built `dist/renderer` in a headless Chromium, a fresh page per check, with nothing on screen and no main process (`test/renderer/`).
It is kept out of `npm test` so that one stays fast; CI runs both, and a failed check leaves a trace to download from the run.
A release runs CI's own workflow on its tag before building anything (`release.yml` calls `ci.yml`), so a tag on a commit that fails a check is never built.
The page is served by answering its requests from `dist/renderer` on a made-up origin rather than from a server, because module scripts do not load from `file://`.

The checks are filed the way the window is made of panels: a panel type's under `test/renderer/panels/types/<type>/` (the `claude` panel's split into `terminals/`, `tab-bar/` and `history/`), the layout tree's under `panels/layout/`, anything that is not a panel under its own name (`settings/`), and what they all use under `support/`.
It is the unit tests' rule too — a test is found where the thing it tests lives — applied to what the checks test, which is the window as its panels draw it rather than one module.
The built-ins are filed the same way, since each is a type drawn by its own modules (§ The app's own surfaces are panels).

`window.claudeUi` is a stand-in (`test/renderer/support/bridge.ts`) typed as the bridge, `ClaudeUiApi`: a call added, renamed or reshaped fails the type check there, instead of leaving a check passing against an API the app no longer has.
It answers from a fixture of plain data (`fixture.ts`), by default a first run with one session and no layout file, and records every call, so a check can assert on what the window sent.
A call it does not model rejects with its own name, and every check fails on anything thrown or logged as an error in the page, so a check that strays onto unmodelled ground fails loudly rather than running on an answer nobody held against main.
The stand-in also writes such a call down, and the check fails on it at the end whether or not anything was thrown, since the window catches some refusals and turns them into a toast, as a delete's does; a check of its own, expected to fail, holds that gate (`test/renderer/harness/`).
A check that needs such a call models it there, from what main does: where main's answer involves no decision of its own, as a plain answer, and where it does, through main's own function moved into `src/shared` for both (`readFrom` for the history's later reads, `defaultUi` for a first run, `settingsView`, `settingProblem` and `appFileChanges` for the settings over the fixture's two files, `resolvePathIn` and `pathProblem` for a path option's check, with a table of what is on disk in place of main's look at it, which counts the folders the listing names and the one the folder picker answers as there unless it says otherwise, and which also answers whether a start's folder is there, refused as main refuses it, `togglePinned`, `toggleArchived` and `withText` for a session's marks and `purgedSession` for all a delete forgets, and `grouping.ts`'s rules and `withText` again for where sessions sit — a project's name, its place and the seeding of it, and its groups — and `withLink` for a session a panel's row started, kept in the fixture so a later read sees the change), so that no rule of main's is kept in two places.
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
The Settings button's corner is none of the window's doing: the layout and every computed style are the same either way, no tooltip is up, removing every animation or switching the raster path (`--disable-gpu`, `--disable-gpu-rasterization`) leaves it, and with the button moved to a whole pixel it goes (measured 2026-10-01).
The comparison lists them, as it lists every pixel that differs, rather than excusing them, and one capture alone is no baseline, so a change is compared against two of the build before it.
The comparison sorts each state's lines, and takes a map of the classes a change renames (`{ "old": "new" }`), applied to the before-capture's element keys only, so a pure rename compares empty.

## Embedded terminal

`@xterm/xterm` in the renderer, backed by `node-pty` in the main process running the real `claude` binary.
`node-pty` is a native module and must be rebuilt against Electron's ABI.
Keeping the real CLI in a PTY is the point: its approval prompts, diffs, and permission modes stay exactly as they are in a terminal.

The shell runs `claude "$@"`, and every flag — the app's own and the user's — is passed after it as a positional parameter.
So nothing the app launches with is ever interpolated into a command string, and no value needs quoting or escaping on the way: a session name with an apostrophe and macOS's `Application Support` path arrive as one argument each.
A shell is still in the middle because it has to be — an interactive login shell is what runs the rc files that put mise, direnv and the MCP servers' tools on `PATH`.

The settings screen refuses any flag that would break the app's model of a session, aliases included, and says which one and why rather than failing at launch.
Three kinds: the ones the app sets itself (`--settings`, `--resume`, `--fork-session`, `--name`, `-w`, `--session-id`), the ones that would leave no interactive claude in the tab (`--print`, `--continue`, `--background`, `--cloud`, `--teleport`, `--remote-control`, `--tmux`, `--from-pr`, `--version`, `--help`), and the ones that would leave a session the app cannot see or read (`--no-session-persistence`, and the `--print`-only output flags).
A leading bare word is refused too: claude would read it as a subcommand, so a field holding `update` would run `claude update` in every new tab.
What is deliberately NOT refused is anything merely risky — `--dangerously-skip-permissions` and the permission modes are the user's call on their own machine, and they do not stop the app working.
`src/shared/flags.ts` holds both halves — the parser that turns the user's line into arguments, and the reserved list — and a test asserts that everything the launcher emits appears in that list, so a new app flag cannot be added without reserving it.

### The app chooses the session id

Every session the app starts is created under an id the app mints, handed to `claude` as `--session-id`.
The transcript then lands under exactly that id, so a tab knows which session it is running before the process has even spawned — and everything keyed by that id (the sidebar row, a group, a pin, a note, the status file) is right from the first paint.

The alternative, letting `claude` pick and finding out afterwards, is what the app used to do, and the cost was spread across the whole renderer: a tab held a made-up `new-<timestamp>` id, group membership for such a session was held in a second in-memory map until the real id arrived, and a row created inside a group could still appear loose and jump into place a moment later.
None of that exists now.

A fork is the one launch that names two sessions: `--session-id <new> --resume <parent> --fork-session`, and `claude` honours both, so a fork is a row of its own immediately rather than one that arrives with the next disk read.

`claude` refuses an id that is already in use, which turns out to be the same question as "does this session have a transcript" — nothing is written until the first prompt, so a session that never got one can be started again under its own id, and a session that has one is resumed by it.
That is the single test `startTab` makes, and it is why a tab stopped before its first prompt keeps its identity instead of coming back as a different session.

**What the flag cannot cover is an id changing mid-life**, and one thing does that: `/clear` ends the session and starts a fresh one in the same terminal, under an id Claude Code chooses.
So a tab also carries a token, set as an environment variable on its pty and echoed back by the status hook, and a reported id that differs from the tab's own replaces it.
Without that the tab goes on naming the session that just ended, and resuming it later reopens the wrong history.
The token names the **terminal**, not the session, which is exactly why the tab's own id could not do the job.

### A cleared session is a new session

`/clear` is "start again here", so the app treats what comes out of it as a session with nothing in it: the folder is all that carries over, and the tab reads `New: <project>` until the session has something of its own, exactly as one started from the "+" does.
Carrying the previous summary forward instead — which is what the code did at first — gave the new session a title, a first message and sibling marks belonging to a conversation it does not have.
Its predecessor keeps everything of its own and stays in the list: it is a real session with a real transcript, and still resumable.
Only the **group** follows the tab across, because a group says where the work lives and clearing does not move the work.
A pin and a note are about one conversation, and that conversation still has its row to hold them.

**The title on disk is left exactly as Claude Code writes it**, and that is a deliberate limit on the above.
Claude Code copies the cleared session's `custom-title` into the new transcript, in the same record a deliberate name is written to and with nothing to tell the two apart — and since a custom title is preferred over a generated one when a row is labelled, a named session goes on wearing the name it was handed.
The app could tell them apart, since it alone sees the end and the start arrive on one terminal, and an earlier version did exactly that.
It was removed: `claude --resume` lists that session under the copied name, and an app that showed a different one would put two names on one session.
**Staying legible next to the CLI beats being tidier than it.**
In practice the case is narrow — 127 of 710 transcripts here carry a name at all, so clearing an unnamed session already produces a blank one with no help from us.

What is kept is the **pairing**, appended to the audit log: which session became which.
Nothing reads it back.
It is recorded because it is observable exactly once and nowhere else — neither transcript points at the other — and whether a cleared session should be shown as related to its predecessor is a question better answered later from what happened than guessed at now.

### Tab lifecycle: a tab can exist without a process

A tab owns at most one terminal, and `terminalId` is **nullable** — null means the tab is **cold**: it has its row in the bar, its title and its place in the layout, but no `claude` behind it.
Cold is a first-class state, not an error one.

A tab goes cold in two ways: it is **restored** that way at launch, or the user **stops** the session with the tab's own button.
What a launch does with the tabs whose sessions were running when the app closed is a setting, `runningSessionsAtLaunch`: by default it restores them paused, so they cost no process and the live strip lists them; `start` starts those whose folders are still there, and `leave` restores them cold like the rest.
Starting every restored tab used to mean 20 processes at ~437 MB each for 20 tabs, whether or not any was in use.
A tab to start is restored paused too, so its start clears the mark, and one whose start fails or whose folder has gone stays in the strip.
It leaves cold by being activated, which starts it immediately; there is no separate "start" affordance, because selecting a tab has always meant "work in this session".

Activating a tab can only ever **resume** it: the tab's own session is all it knows about.
The arguments that apply to a session's first start and to nothing afterwards — `--fork-session`, `--name`, `-w` — belong to the call that creates the tab, so that call selects the tab *without* starting it and starts it itself.

Two exits must stay distinguishable.
A **user stop** sets a `stopping` flag before asking claude to leave, and the exit handler checks it first: that tab is cooled and kept, or removed when the stop was a close (`closing`).
**Any other exit** closes the tab, which is deliberate — it stops a finished session leaving an empty tab behind.

That separation is what the tab's button is built on: ending a session and removing a tab are different intents, so one press does not decide both.
The first press stops a running session and leaves the tab cold, the second removes it, and a tab that is already cold goes in one.
A session arriving disables the button rather than merely ignoring it, and so does one leaving, for its first second and again once it has been forced: a tab acted on before its process has arrived, or in the moment its process takes to go, would leave the bar disagreeing with what is actually running.
A session still there after that second makes the button a force (§ Stopping a session is a request).
The mark follows the state, so which press you are on is visible: a stop square while there is a session to end, filled once pressing it forces the session out, and a cross once there is only a tab.
Everything else about the session is in a kebab beside the button: the session's menu, the one its row in the list has, which the session list hands the tab bar through an ask (`sessionMenu`), since the two built-ins never import each other; a right-click on the tab opens the same menu from the kebab.
The kebab costs a tab 12px, its own width: it takes the tab's gap before it and sits right against the button after it, so the cap on a tab's width went from 200px to 212px, and a long title shows as much as it did without one.
Every kebab is 12px wide, hugging its three dots, where a standard icon button is 24px and a compact one 22px: the dots are 2.6px wide, and the rest of the box was empty space that read as a gap between a kebab and the control beside it (`.icon-btn.kebab`, with a mark drawn only as wide as its dots).
Its hover and its open menu turn the dots accent and nothing else, as every borderless icon button's do (§ UI conventions, Hover), since a fill on the 12px box was a thin sliver and a wider one ran into its neighbours.
A menu opened from it is placed so its notch can reach the middle of so narrow a trigger (`openMenu`).
Showing the kebab only on hover or on the tab on show was rejected: the tab would change width under the pointer.
A third case sits in between: an exit within 1500ms of launch is treated as a failed start, and the tab is kept with the error visible in its terminal.
Its process has gone, so the tab is cold like any other — its button closes it in one press, the live strip drops it, and selecting it starts it again on a wiped terminal, or says on the pane why it cannot — but until then its terminal stays on show in place of the pane and its history opens over it (`startFailed`), since what claude printed is the explanation.
It used to keep the dead process's id, which main no longer knew, so its stop was ignored and its button never closed it.

The cold state is visible in three places, all reading the same `terminalId === null`: the tab is unfilled rather than dimmed, the session row's left bar and the selected tab's top edge are `--muted` instead of accent, and the terminal pane explains that clicking the tab resumes it.
Those two marks answer the same question, so they answer it the same way — accent means a live session, nowhere else.

A cold tab can also be **paused**: set aside to come back to, a mark beside the cold state rather than a fourth state, so everything that reads `terminalId` goes on reading it unchanged (`paused`).
It exists because a stopped tab and one that came back cold from a restart looked the same, and a pile of the second kind hid the few still in hand.
Pause and Unpause are in the session row's menu while the session has a tab, Pause unavailable while the tab is starting: pausing a running session asks its claude to leave as a stop does, and the mark is set at once, so a pause still waiting for claude to leave is kept as paused; pausing a cold tab only marks it, and forgets any status it still held.
Nothing is suspended: the process is ended, not frozen, and opening the tab resumes the session as any cold tab's does, reloading its conversation.
A prompt reported before claude has gone calls the pause off with the stop; one submitted just before the pause can do so too, and the tab then closes at the exit, as it does for a stop.
An Unpause during that wait lets the stop go on, leaving the tab cold.
The mark is a state of the session's dot (`dotStatus`), two bars in place of its last report once claude has gone, so every dot that stands for one session reads it from one rule: the tab's, the session row's, the strip's, and a list panel's row mark and session menu items.
A roll-up, such as a project's in the switcher, and the attention toasts read the status itself, which for a session claude has left is `closed` and nudges nothing.
A paused dot is no control and never shows the session's mark read, since it reports no claude, and a click on it goes to what holds it, which opens the session and so resumes it, unless its folder has gone.

The live strip lists paused tabs beside the running sessions: its membership is a tab with a process or a paused one, since a tab you set aside is work in hand in the same way, and as far out of sight in another project.
A paused row keeps its place in tab order rather than gathering in a section of its own, so pausing or resuming a session never moves its row, and the strip now comes up at launch whenever a paused tab is restored, where it used to start empty and hidden.
Its line counts the two apart, `2 of 5 need you · 3 paused`, so "live" stays true of what it counts, and the line never counts a paused session as wanting you, whatever status it still holds.
A row's button is its tab's button, drawn by the same rule (`tabButtonState`) and pressed through the same function (`closeOrStop`), so on a paused row it closes the tab, as the tab's own button does on a cold tab.
Beside it, a kebab opens the session's menu, the one its row in the list has (`sessionMenuItems`), so a session in another project can be paused, unpaused, noted, filed or archived without going there; Fork and a sibling take you to the tab they open.

Where you were is remembered twice, in meta: `activeSession` (which tab to open on at launch) and `activeSessionByProject` (which to return to when you switch back to a project).
The in-memory `activatedSeq` still decides while a project has something running; the stored map only matters when nothing does, which is how a launch begins.
The remembered tab is *selected* at launch, and starts with the others only if it is one of them — a deliberately open question for one that is not, since a tab marked active with no process behind it is arguable.

What was running is remembered with the open tabs, in the same write: `runningSessions` holds the open tabs that have a process, from the moment it starts until it has gone, so a session still being stopped counts.
The window stops writing once the app quits, so the exits the quit causes are not recorded, and a launch reads the list before its restore writes the open tabs again; after a crash, the sessions running at the crash come back.
The tabs you paused are in the same write too, `pausedSessions`: a launch restores them paused and never starts them, even one also kept as running, whose claude had not left yet when the app closed.
A tab loses the mark when its session's process arrives, and gets it back if that start fails within its first moments; a start that is refused or throws never had a process, so the mark stays.
The mark is written whenever it changes, with the rest.

The code is in `src/renderer/panels/types/claude/terminals.ts`: each tab's terminal, its life from built to closed, the workspace switch, the fit of the tab on show to the terminal area, and the open tabs kept for the next launch.

### Stopping a session is a request, and claude may answer it with a question

A stop, from the tab's button or the live strip's, and a close of a live tab ask claude to leave the way it is left in a terminal: Ctrl-C twice, 400 ms apart, from its prompt.
Mid-turn the first press only interrupts the turn, so a session whose hooks last reported it busy or waiting gets a third, and any other gets two, because a third at its prompt would arm claude's own "Press Ctrl-C again to exit" under anything it asks.
Waiting is a permission prompt, or a `Notification`, which claude also sends to a session sitting idle at its prompt, so such a session gets the third press too.
The presses are bytes written to the pty, which claude reads as keys while it holds the terminal in raw mode.

**Nothing follows them.**
Claude can answer an exit with a question — a worktree session with uncommitted changes asks whether to keep the tree or remove it — and waits for the answer.
Nothing it sends tells asking from being slow: every stop probed on claude 2.1.289 printed something after the presses, and in the one run that logged hooks none fired in the 5 s the question was up.
So the tab stays, stopping, with its terminal kept and answerable in the tab, until the pty exits, however long that takes.
An earlier version sent `SIGTERM` 1.8 s after the first press, which killed the question and left the tree kept but locked; it also ended every stop of a session mid-turn, which two presses alone did not end in either run probed.
A close keeps the tab the same way and removes it when the exit lands, since a tab removed first is what made the question unreachable.
Esc at the question calls claude's exit off, and the next prompt the session submits clears the stop: the status hook names the event that reported each status, and `UserPromptSubmit` is the one only a session that stayed can send once the stop is pressed.
Until that prompt the tab goes on saying it is stopping.
A prompt submitted a moment before the stop, whose report arrives after it, calls the stop off just the same, and the exit that follows then closes the tab instead of cooling it.

A session still there a second after the ask can be **forced**: its stop control, disabled for that second so a double-click cannot force before the question is on screen, then sends the process group `SIGTERM`, and `SIGKILL` if it is still there after the grace below.
Quitting the app forces every session without asking, since a question would have nobody to answer it, and a panel shell's stop forces it too, since a shell has no Ctrl-C exit to be asked through.
Closing the window on macOS, where the app stays without one, forces them the same way: a window opened again from the Dock brings back the ones that were running as `runningSessionsAtLaunch` says, starting them afresh when it says start, and were they not forced, a start would put them beside the old ones, which no window could reach any more.
So a window opened again waits, as a quit does, until what the last one ran has gone.

Forcing is one function, for every route.
The stop, the close and the quit used to be three, each sending a single signal and then forgetting the process: a bare `kill()`, which is `SIGHUP` and which a Node program is entitled to decline.
The stop then reported success over a session that was still running.

Two things make it work now.
**The signal goes to the process GROUP**, not to the process the app spawned.
That is the part that matters here: the app never talks to `claude` directly, only to a login shell that runs it, with `claude`'s MCP servers below that — so signalling the one process it knows about is the one thing guaranteed not to reach what it means to stop.
It is sound because node-pty's child leads its own session, measured rather than assumed: `pid == pgid == sid` for every live session, so the pid doubles as the group id.
**And it escalates**: `SIGTERM`, then `SIGKILL` for anything still there after a 3 s grace.
A worktree session left on `SIGTERM` in 0.75 to 1.52 s across five runs, and ran its SessionEnd hook on the way in the one run that logged hooks; the 1.2 s grace there was before cut the slow end short.
Whether the first worked is read from the pty's own exit — the one place a session is recorded as over — rather than inferred from having sent something.
A session that left politely is never killed afterwards, because by then its pid may belong to somebody else.

`before-quit` delays the quit until everything stopped has gone, or the grace and half a second more have passed, which is what gives the escalation room to land, so quitting is not a special path.
It waits for the exits rather than for a fixed time, so a quit with only claude sessions to wait for is usually over well inside the grace.
A panel's shell is asked with `SIGHUP` rather than `SIGTERM`, the signal a closing terminal sends: an interactive login shell in a pty, bash, zsh and dash alike, was measured still there 5 s after `SIGTERM`, and gone at once after `SIGHUP`, idle or with a command running in it.
The shell passes the `SIGHUP` on to that command, which sits in a process group of its own, so a command that ignores `SIGHUP` outlives the shell, as it outlived `SIGTERM` before.
With `SIGTERM` every shell waited out the grace for its `SIGKILL`, and held the quit up for as long.
Not implemented, and deliberately: their design also sweeps the group once more *after* the leader exits, for a grandchild that changed its own group.
Nothing here has been observed needing it, and a `SIGKILL` aimed at a group id that no longer exists is the one version of this that could reach an innocent process.

### A session whose folder is gone

A session cannot run anywhere but its own directory, so when that directory is missing the app **refuses**, in two layers.

The launcher refuses the spawn outright.
It used to substitute `$HOME` instead, silently: the session ran somewhere nobody chose, and then wrote its transcript under the home directory's project, so it moved in the sidebar too — the only sign being Claude Code asking for workspace trust on `~`.
That is the backstop, and it is deliberately below the UI, so nothing can reach a spawn by another route.

Above it, the session list carries two facts per session: whether its **own** directory exists and whether its **project's** does.
They are separate because a removed worktree leaves its repo perfectly usable, while a removed repo takes its worktrees with it — and the wording differs for the same reason.
A missing worktree names the tree to recreate, since `git worktree add` at the same path brings the session back; a missing project has nothing smaller to point at.
Both are re-derived on every listing rather than cached beside the summary: a folder can be removed or put back without the transcript changing, and one stat per distinct path covers hundreds of sessions.

What that buys is a row that says so before you click it.
A session whose folder is gone is dimmed and unclickable with the reason in its tooltip, its **Fork** item stays in the kebab but dimmed and inert, and the "+" on a project whose root is gone is unavailable with the same explanation.
Its tab, if it has one, is dimmed by the same rule with the same tooltip, and that is what tells it apart from a cold tab: cold is unfilled and resumes on a click, dimmed will not start at all.
The tab still selects on a click, since the pane is where the reason is said in full.
An action that cannot be taken is shown rather than removed: a menu that changes shape has to be re-read, and an item that vanishes looks like it was never there, where a dimmed one answers the question you opened the menu to ask.

**Unavailable is `aria-disabled`, never the `disabled` property**, and the reason is the tooltip: a natively disabled button emits no mouse events in Chromium, so a tooltip delegated from `document` never fires and the only thing explaining the refusal is invisible.
`setUnavailable()` marks a control and carries the reason; the click handler refuses with `unavailable()`, which is the trade for a tooltip that works.
**Management stays**: pin, note, archive and delete all keep working, because cleaning up after a folder that has gone is exactly when you need them.
One function produces that sentence and the tooltip, the toast and the pane all use it, so they cannot drift.

**A project whose folder is gone is marked wherever it is named**, not only through its rows: its heading, the switcher's entries and title, and the tab bar's project label.
The name is muted and the crossed-out folder — the "folder gone" filter's own mark — sits beside it, with the reason as the tooltip.
The heading swaps its folder icon for it, since it already has one in front of the name; everywhere else it comes after the name, so a dead project's name lines up with the rest.
A muted name only says something beside names that are not muted, so the tab bar's project labels are in full text colour like the headings, where they used to be muted themselves; a group's label under its project is told apart by its rail and its lighter weight instead.
Muted rather than dimmed, because the project is not disabled: it can still be folded, selected, renamed and cleaned up, and selecting it is how you get to its sessions to do that.
Scoped to it, the empty pane says the same sentence instead of pointing at sessions or tabs that cannot open.
One rule decides it (`projectRootExists`, which the list's headings and the switcher's model both call), one function says it (`projectGoneReason`, shaped like the session one), and one helper draws it (`markProjectGone`).
Marking was chosen over hiding: an unmounted drive would make a project you use every day vanish without a word, and a dead project nobody is coming back to already has a way out — delete or archive its sessions, and it leaves the switcher with the last one.
Nor does it move: a dead project keeps the place you gave it, since a project that sank to the end whenever a drive was unmounted would move a list under the person reading it.
The live strip's project headings are marked too, since a strip row can belong to a dead project: a paused tab's, or a running one whose folder was removed under it.
Group headings and the panels are left alone on purpose: the project heading above a group is sticky, so its mark is on screen the whole time; and a panel already refuses a folder that is not there, in words about its own folder.

Two cases no amount of gating can pre-empt — a folder that disappears while the app is running, and a tab you are already sitting on — which is why the refusal still has to explain itself when it happens.
A tab is kept, cold, rather than closed: the click meant "look at this", and the folder may come back.

`claude -w` also `git worktree lock`s the tree it cuts.
Answering Keep on the way out releases the lock, but a session ended by `SIGTERM`, or one that leaves without answering, leaves it behind, and a later `git worktree remove` refuses until that lock of a dead pid is cleared.

## In-session history

Claude's fullscreen renderer (`"tui": "fullscreen"`) draws on the terminal's alternate screen and scrolls itself, so the terminal keeps no scrollback of the conversation, and claude publishes neither where it is scrolled nor how tall the conversation is.
So nothing here can follow claude's own scrolling, and marking lines in the terminal's buffer — xterm markers placed as each request is sent, the first design — has no line to hold on to.
The app draws a history of its own instead, from the session's transcript, which holds every request and reply, outlives every restart, and keeps what a compaction took out of claude's own view.
The code is in `src/main/transcript.ts` (reading) and `src/renderer/panels/types/claude/history/` (the view, the bar and the loupe), and what hands the pane to it and back — the ways in, the keys, and the sentence it stands under for a cold tab — is the pane's, `src/renderer/panels/types/claude/pane.ts`.

### Opening it, and getting out

**The history opens only on purpose**: from the bar beside the terminal (a press, or the loupe), the arrow at the bar's foot, or Ctrl+Shift+↑ for your last request — every way in goes through one function, `openHistory`.
The wheel over a running claude stays claude's, and scrolls claude's own view.
Inside, Ctrl+Shift+↑ and Ctrl+Shift+↓ step to the previous and next request, and ↓ past the last one goes back to live; previous and next measure from the request line, which is where a jump puts the view.
Both are caught on the window in the capture phase, before xterm, which would otherwise send them to claude; app shortcuts take Ctrl+Shift because a bare Ctrl+letter belongs to the terminal.

**It is a drawer from the bar**: it slides in from the right edge, beside the bar it was opened from, over about two-thirds of the pane — never narrower than 560px, and the whole pane when the pane is narrower than that.
Claude stays in view on the left, live and at its real size under a scrim that dims it; the terminal is never resized for it, so claude never redraws, and a click on the dimmed claude is the way back.
The scrim takes that click rather than passing it to claude, as a drawer's does.
**Getting out is otherwise one labelled control**, "Back to live", in the history's head and always in view, with Esc as its key; the focus goes back to the terminal.
The first versions covered the whole pane, and "how do I get back?" was the question they left.
The next took the upper two-thirds and left the lower third to claude, where a click went back and reached claude as well; in use it read as a split panel rather than something laid over claude, so it was replaced by the drawer.

That is the second version, and the first is worth knowing because it was tried and reversed after use.
It took the wheel: xterm asks `attachCustomWheelEventHandler` before it sends a mouse report or turns the wheel into arrow keys, so answering false keeps the wheel from claude, and a wheel up over the alternate screen handed the pane to the history, scrolling on past its end handing it back.
It read well as "scrollback that remembers everything", but in use a scroll that turned into another mode was a surprise, claude's own wheel scrolling was gone, and the point of the app is to work in a session, not to read it.
The exit was a floating pill at the foot and End, and was not found.

The history is ONE view, for the active tab, rebuilt when the tab changes.
**Each tab keeps its own state**: leaving a tab with its history open remembers where — the request at the top and how far past it, or the end, where it keeps following what claude adds — and coming back reopens it there once it has been read again; a tab left live comes back live.
Coming back shows the tab live until that read is done, since there is nothing to draw before it.
The memory lasts as long as the tab and the run, not across a restart, and it is kept per session, so a `/clear`, which starts a new session in the same tab, closes the history.
Switching tabs always closed the history at first, which lost your place in it whenever you looked at another tab.
It is kept laid out beneath the live terminal — hidden by visibility, never display — because the bar beside it places its marks from the history's measured heights, and a node with `display: none` measures as nothing.
Its width is the drawer's over a live tab and the whole pane's on a cold one, so it re-measures the marks whenever its own size changes, since every width rewraps the replies.

**It is drawn in slices**, with the window free between them, since it is drawn on every switch to a tab, open or not.
Drawn at once, the longest session here (761 requests) held the window for 1–2 s on each switch, and a profile put most of that on the browser laying out the whole new list in one go, not on the app's code; `content-visibility: auto` on each exchange did not cut it, and broke jumps, since positions were then measured against placeholder heights.
First the newest exchanges, up to 12 ms of work, which is where the history opens and what Ctrl+Shift+↑ goes to; then the rest from the oldest up, a slice at a time, each put in just above that newest part, so each one lays out only itself and what sits below it.
Drawn newest first all the way down, every slice went in above everything already drawn and the browser laid all of that out again: twice the work in total, in slices that grew to 300 ms.
Now no slice holds the window much past 90 ms, and the longest session is whole after about 2 s; the bar measures at most every 250 ms meanwhile, since it measures the whole list each time.
Coming back to a tab left open further back than the newest slice reopens it once its slice is in.

**A tab with no claude behind it** that is on screen, the one restored at launch or one refused a start, shows the pane's sentence — "“…” isn't running." — with a Resume button, which starts it as a click on its tab does, and a Show history button.
The history then stands under the same sentence, one function for both, with Resume and Close; there is no "Back to live", since there is no live view.
With the folder gone, Resume is unavailable with the reason, and Show history still works, since reading a session whose folder has gone is exactly when you want it.
Showing the history there by itself, at launch, was tried and reversed: it was not clear what had happened or why it was shown.
The bar is out of sight on that sentence, and while a tab is starting, and comes with Show history, since until then there is nothing for it to scroll; it was there at first.
It is hidden by visibility, keeping its column, so the terminal's width does not change when the tab starts and claude is not redrawn.
A stopped tab still drops you to the empty screen; reopening it resumes claude, and the history is then on the bar.

### What counts as a request

A typed prompt, one with a pasted image, one sent while a tool ran, one queued while claude was working — a `queued_command` attachment, which is not a user record at all — and a slash command claude answered.
Not a request: tool results, meta records (a skill's expanded body, a message from another session, a subagent's hand-back), compaction summaries, interruptions, and Claude Code's own tag-wrapped plumbing (a local command's output, a reminder, a task notification, `!` bash mode), whether it comes as a user record or queued while claude worked — the queued ones were missed at first, and drew 253 task notifications as requests.
A subagent's hand-back is queued too, marked meta on its attachment and wrapped in a tag with an attribute (`<agent-message from="…">`), which the plumbing rule at first did not take for a tag: 149 of them, in 41 of 445 transcripts, showed as requests until a queued record was held to its meta mark as a user record is, and a tag to its name whatever attributes follow.
Its report is drawn in the reply instead, where it came back (§ What it looks like).
The rule was taken from a scan of 312 transcripts, and the numbers below are from them.

**A slash command counts only once claude answers it.**
`/review` and `/learn` are answered, `/model` and `/clear` are not, and nothing in the command line tells them apart — `/learn` usually has no arguments, `/model` usually has one; 265 were answered and 112 not.
So a command waits for an assistant record, across reads of a file claude is still writing, and is dropped if the user sends something else first.
Leaving slash commands out altogether was the first rule, and it left a session that was one `/review` doing all the work with an empty history.

**A transcript is a tree, and it keeps abandoned attempts.**
Stopping claude and sending again, or editing and resending, leaves the first attempt in the file beside the second, both hanging off the same parent record.
The history shows it, dimmed and marked "sent again", rather than hiding it, so a stopped attempt's partial reply and a pin on it stay; 268 of them in a later scan, of 353 transcripts, which the numbers for rewinds and records written twice come from too.
**Claude's rewind leaves the requests it went back past** in the file too: a later request hangs off the same parent as one further back, and every request in between follows on from that one.
All of them are marked "rewound" and dimmed the same way, since claude's conversation no longer has any of them; 59 requests in 2 sessions, in one of which the request after the rewind says "I rewinded, but one too many".
A same-parent request further back that the ones since do not all follow on from is left unmarked, rather than guessed at: there were 304 such at first, and all but those 2 rewinds turned out to be records Claude Code writes twice (see Reading a transcript).

The session list's first message is deliberately NOT the history's first request: the list is labelling a session, where `/model opus` beats a blank row, and the history is listing what was asked.

### Reading a transcript

The first read of a session is whole, and every later one reads on from a byte offset; the largest transcript here, 50 MB, reads whole in about 0.3 s and reads on in under a millisecond.
The whole read goes in 4 MB pieces with the main process handed back between them, so it holds the main process, and every terminal's output with it, for at most about 40 ms at a time; measured, so no worker is needed.
The partial last line is kept as bytes rather than text, because a read can end inside a multi-byte character; a newline byte never occurs inside one, so cutting at the last newline leaves whole characters on both sides.
A file shorter than what was already read is read again from the start as a new generation, which tells the window that nothing it holds is still good.
Only the last exchange ever changes — claude's reply to it grows — so each read hands back the caller's last exchange again with everything after it, and the window redraws only those.
A rewind is the one exception: it marks requests the window already holds, so that read hands them back again from the first it went back past.
The window reads on `sessions:changed` and on the active session's status events.

**Claude Code writes records twice.**
After a compaction it writes much of the conversation into the file a second time under the same uuids, with only bookkeeping changed (git branch, version, prompt id; the message itself in 3 of 6,490 copies, in 8 transcripts).
Folded as they came, those copies drew 302 requests, and 763 of claude's messages, twice, and a pin on one lit both.
The reader folds each uuid once and keeps the first copy.

### What it looks like

**Like claude's own view of the session**, because the history is a look back at that same view: the terminal's background, face and text colour — one token, `--terminal-fg`, which xterm reads back as well — and its tight line height; your request as claude echoes it, `> …` on a tinted band, with its number, time and marks at the band's end; and each of claude's messages, and each tool call, behind the dot claude marks them with.
**A step smaller than the terminal**, 12px against 13px, on purpose: the browser draws the same face heavier than xterm's character grid does, and at the terminal's own size the history read louder than claude beside it.
The app's own face for claude's prose was tried beside it headless and not taken: the history is to read as claude's view.
The `>` stands in the same gutter as claude's dots, centred where they are, so a request's text starts where a message's does, and its later lines start under its first line's text, as claude indents them.
So the reader keeps a reply as `parts`, in the order claude wrote them: every message its own part, every tool call a one-line part where it came.
The first version joined the text into one reply and folded the tools to a count, which made consecutive messages one block and put every tool call in the wrong place.
A tool call is drawn as claude draws one, a green dot, the tool's name in bold and what it acted on in grey; drawn like a message, with the same dot and ink, the two were too much alike to tell apart.
**A run of tool calls between two of claude's messages is folded to one line**, as claude folds them — "Ran 4 shell commands, read 1 file", with a chevron — which opens into the calls; it stays open or closed while claude's reply grows.
That is a fold in place, where the first version's count was one for the whole reply.
A lone call stays its own line, since its line says more than a count of one, and an edit (Edit, Write, MultiEdit, NotebookEdit) is never folded and ends a run, so the changes to files stay in view, as claude shows them apart.
The line uses claude's words where they are known ("ran N shell commands", "read N files") and plain ones otherwise; claude also folds edits to its scratch files into the line, which is not copied, since telling a scratch file from a project file would be a guess from its path.
Measured on two sessions, of 906 and 54 requests: 417 runs fold, and 1,202 calls stand alone.
**A subagent's report is folded to one line too**, "claim-checker reported", where it came back in the reply, and it ends a run as a message does; it opens into the report as markdown, drawn by the same rules as claude's messages.
Where it came back is not always beside the Agent call that started it: of the 151 reports on the machine this was written on, 57 follow their call, 42 follow another report, from agents started side by side, 50 follow some other tool call claude made meanwhile, and 2 open a reply; a few came back after a new request, and sit in that request's reply.
Folded, since a report runs to several kilobytes (0.5 to 21 KB as drawn, about 5 KB in the middle) and open it would outweigh claude's own reply.
The report is cut from the frame Claude Code hands it back in, a preface ending in "The report follows:" and then the report with every line indented two spaces, the same in all 151; a report without that line is shown whole rather than cut where the frame is guessed to end.
A note Claude Code puts on a report itself, that it "matched instruction-shaped pattern(s)", stays, since it is about that report, and so do the tags it escapes as `<\`.
The agent's name is in every one of those records written by claude 2.1.286 or later, and in none written before; a report without it reads "A subagent reported", rather than having its name traced back through the Agent call's result.
A report has no star: pinning one waits for a list of pins across sessions, which is what would make a pinned report worth having.
The dot is drawn in CSS rather than claude's `⏺` glyph, since the app draws no mark from a font.
**A line break in claude's text, or in a subagent's report, is a line break**, as it is in the request above it, which keeps its own with `white-space: pre-wrap`.
CommonMark's default joins the lines of a paragraph, which suits prose wrapped at a fixed width and ran a reply written a sentence to a line into one block, so the markdown is rendered with `breaks: true`: a line break inside a paragraph, a list item or a quote becomes a `<br>`, and `#` headings, code blocks and tables come out as they did.
A `<br>` in the markup rather than `white-space: pre-line` on the message, since a stylesheet cannot tell a line break in the text from the newlines markdown-it writes between tags, which `pre-line` turns into blank lines.
Code is told apart by colour and by place: inline in the accent, a block on a panel of its own, a step lighter than the history and scrolled sideways rather than wrapped.
A block had a rule down its side at first, which is how a quote is drawn, and a block read as a quote; a quote keeps the rule, in the accent's muted tint, with its words in italics.
The history has no scrollbar of its own: the bar beside it is its scrollbar.

### Pins

A request and each of claude's messages can be pinned.
Each star stands in the gutter, in place of the mark there: the request's where its `>` is, a message's where claude's dot is.
Both show on hover and always once pinned, and what is pinned has an accent line in the margin beside it, as its mark on the bar is in the accent.
A pinned request had an accent edge inside its band at first, which the star now stands on.
On the bar a pinned reply is in the accent as a pinned request is, and in the loupe it carries the star.
What is shown is a labelled switch in the head, `All 54 · Pinned 3`, in the filters' pill: an unlabelled star did not say it was a filter; the count is of pins, and Pinned shows every exchange holding one.

A request is pinned by its record's uuid, and a message by its assistant record's uuid and its place among that record's messages; a fork copies uuids, so a pin shows in both siblings.
Each pin keeps its kind, the session it was made in, the opening of the text and its time, so a list of every pin can be drawn from `meta.json` alone.
They are stored as `historyPins`; request pins made before messages could be pinned were stored as `requestPins`, which is still read, and written back as `historyPins` the next time `meta.json` is saved.
Deleting a session leaves its pins: a sibling may still carry the request, and telling which pins nothing opens any more takes every transcript read, which is a job for a list of every pin rather than for a delete.

### A reply is untrusted text

Claude quotes web pages, files and tool output, so a reply is rendered with raw HTML off (`markdown-it`, `html: false`): markup in it is shown as text.
Its link check refuses `javascript:`, `vbscript:`, `file:` and `data:` links, bare URLs included, and images are not rendered, since the CSP would refuse a remote one and leave a broken icon.
Every link click, middle-click included, goes to `shell:openExternal`, and main refuses any navigation of the window besides (see Processes); the CSP is the last layer.
`marked` was the alternative, and passes raw HTML through, so it would have needed a sanitizer beside it.

### The bar and the loupe

The bar at the terminal area's edge is the history's scrollbar, there while claude is live or its history is open: a tick across it per request, a thin bar down its middle per reply — a shape apart, not only a shade — pins in the accent, a request sent again dimmer, the last request in white, and, while the history is open, a band for where you are in it, with the marks inside it lit as the loupe's entry is, a step dimmer so that one stays the brightest.
The band alone, a faint wash on a 14px bar, was not seen.
There is no band while live: the wheel scrolls claude's own view there, and where claude is scrolled is not something the app can know, so any band would be a guess.
It is a column of its own rather than an overlay, so it never covers claude's text; the terminal is that much narrower, and the fit hands the pty the new width.
**Pointed at, it is drawn wider**, 24px against the column's 14, so it is easier to stay on; it stays wide while the loupe is open or a press is held.
The extra width lies over the terminal's edge, as the loupe does, and the column itself never changes: a wider column on hover would narrow the terminal and make claude redraw every time.
**A request is a target of about 9px** around its tick — 4px above, 5px below — where it was about 5 and hard to hit, and its tick is drawn a pixel taller; its reply has the rest, down to the next request, and two requests closer than that split the room between them.

**Pressing on it is a scrollbar's**: the view goes to that point at once, opening the history if it is closed, and follows the pointer until the button is let go; pressed on the band, it holds the band where it was taken instead of jumping, as a thumb.
It follows the pointer anywhere on the window until the button is let go, since a hand's drag drifts sideways off a 14px bar, and from any pointer, since WSLg sends a held button's moves as another one (see Traps).
It is the rough way to a place, and the loupe the exact one: the loupe hides while the button is down and is back when you let go, and a click on its row, or Enter, opens that entry.
The first version started a drag only after 4px of travel and took a press that did not move as a click on the loupe's entry; in the user's words, what was wanted is "press the mouse on a point in the sidebar, then the view should already go there".
Neither the bar nor the loupe takes the focus, so the terminal or the history keeps the keys: a click on either used to leave the focus nowhere, and Esc and the step keys with it.

Hovering it opens the loupe, the entries around the pointer in words, and the wheel steps it one entry per notch, a trackpad one per 30px.
That is the answer to the hard requirement, that one exact request or reply be reachable in a session of hundreds: at 821 requests the bar has under a pixel per entry, so the pointer alone picks roughly.
A fisheye on the bar itself was tried in a mock and rejected — it spreads the entries under the pointer, but the pointer still moves through them too fast to stop on one.
The loupe stays on an entry once the wheel has stepped until the pointer really moves, and keeps it when the pointer crosses into the loupe, so reaching for it does not undo the choice.
It takes the arrows, Enter and Esc only while the pointer is inside it or the history has the pane: with the pointer merely resting on the bar, the live terminal has the focus, and a prompt typed with the pointer parked there must still reach claude.

Rejected from the same mock: a popover from the tab bar (no scrollbar), a panel (a layout-file entry today), typing claude's own transcript-mode keys into the pty to move claude's view (it lands wrong when claude is in another state, and nothing says so), and xterm's own overview ruler (only on claude's default renderer, and its marks go with the process).

## Status cues

Rather than parse terminal output to guess a session's state, the app drives status from Claude Code hooks, and reads the transcript only for the ends no hook reports (below).
On startup it writes a hook script and its own settings file to `~/.config/claude-ui/`, and passes that file to `claude --settings`, whose hooks merge with the user's own — so claude-ui never writes into `~/.claude/settings.json` (an earlier version did, and still strips those entries when it finds them).

Seven events map straight to a status: `UserPromptSubmit` → busy, `PostToolUse` → busy, `PreCompact` → busy (compaction, below), `Stop` → idle (or background, below), `Notification` → waiting, `PermissionRequest` → waiting, `SessionEnd` → closed.

**A permission prompt is waiting from the moment claude asks.**
Claude sends a prompt's `Notification` about six seconds after the prompt appears, and none at all once it is answered sooner, so for a prompt within a turn the dot used to say busy for those six seconds, and throughout a prompt answered quickly.
By claude's source the six seconds count from the later of the prompt appearing and the last key pressed at it.
That notice is the same question again, so the script writes nothing for it over the waiting a `PermissionRequest` wrote, which keeps a dot marked read meanwhile marked read.
`PermissionRequest` fires as the prompt appears, and fired for no call claude let through without asking (measured on claude 2.1.289: four prompts, and seventeen calls in default mode and three in auto mode that needed none), so it does not flash the dot to waiting on an ordinary tool call; another `PermissionRequest` hook that answers the request itself would, until the tool has run, or, if that hook turns it down, until the next hook (by claude's source).
Approving the prompt is the tool running, `PostToolUse` → busy, and turning it down without a word, with Esc or from its menu, is an interrupt in the transcript (below), which ends the turn (both measured).
Turning it down with feedback, which a Bash prompt takes as its No amended with Tab (a WebFetch prompt has no such field), does not interrupt the turn: claude writes the refusal with the feedback and carries on, and no hook fires, so the dot said waiting until its next tool had run or the turn ended (measured: 1.0 s when claude answered at once, 7.9 s when it thought first); the transcript now ends that waiting with busy (below).
Esc at a background subagent's prompt refuses its call without an interrupt; in the one run, the subagent then finished on its own, and its end started a turn of the session's two seconds after the Esc.

**A turn that ends with work still running has not finished, so it reads as `background`.**
`Stop` carries the work the turn started that still runs, such as a backgrounded shell, a monitor or a subagent sent off in the background, as `background_tasks`, and while that list holds anything the script writes `background` instead of `idle`.
For a backgrounded shell, a monitor and a background subagent, the work's end made claude start a turn of its own, which ended in a `Stop` with the list up to date, so nothing else needs hooking (measured on claude 2.1.289, one probe each).
It takes idle's place and no other's: busy already promises more output and waiting must always win, so it can never hide a session that needs you, which is why it is a state and not a mark of its own beside the dot.
To the roll-ups it is busy, with no "finished" to carry and nothing to mark read, while stopping it sends the two presses an idle session gets, since claude's prompt is open.
With a background shell running, claude answered those presses with a question, exit and stop the work or stay, rather than leaving (measured once; claude's own code leaves some kinds of work out of that question, and a worktree session asks about its worktree instead), and the tab stays up for it as for any question on the way out.
Work you stop yourself, from claude's own task list, started no turn and fired no hook at all (measured with a background shell and a monitor; a subagent stopped that way started a turn, whose `Stop` ended it as above), so the transcript ends it (below).
The dot's tooltip names the work by the type claude gives each piece (`shell`, `subagent`, …), counted per type, as in "2 shells, 1 subagent"; a monitor that watches a shell command arrives as a `shell`.
The script reads those from the `type` keys, which in `Stop` only the list's entries have, and a claude too old to send the list reads idle, as before.
The launch read passes on the status alone, so a `background` read back at launch says no more than that.
Scheduled wakeups (`session_crons`, from `/loop` and the like) are not counted: nothing runs until they fire, and counting them would keep a looping session from ever showing finished.
Claude's idle notice does not end it either.
A minute at its prompt without input (claude's default, which its own config can change), claude sends `Notification` with `notification_type: "idle_prompt"` ("Claude is waiting for your input"), and it does so while a shell it started still runs; the script writes nothing for that notice over `background`.
The same notice a minute after the work's own turn has ended is the one that says waiting, as for any finished session (both measured on claude 2.1.289, with a background shell).
Every other notification, a permission prompt or a question, still writes waiting over it.
Its dot is busy's spinning ring around a small core of idle's green: the turn is done, and work goes on.

**A subagent's events arrive as the session's, and once its turn has ended they are not the session working.**
Hooks fired inside a subagent carry the session's own id, told apart by `agent_id`, so a background subagent's tool call wrote busy over a finished session, and the dot went idle, busy and idle again with nobody doing anything.
The script never writes busy for such an event over idle or background.
Waiting still goes through, since a question must never be held back, and a foreground subagent is unaffected, since its session is busy or waiting for as long as it runs.

**An interrupt, work stopped from claude's task list, and a prompt turned down with feedback fire no hook, so the transcript ends them.**
Ctrl+C or Esc interrupting a turn during a tool or while claude writes fired nothing, nor did Esc at a permission prompt (measured once), nor a shell or a monitor stopped from `/tasks` (all on claude 2.1.289), so the dot stayed busy, waiting or background until claude's next turn.
Both are written to the transcript: an interrupt as a user record saying exactly `[Request interrupted by user]` or `[Request interrupted by user for tool use]`, and the end of a piece of work as a queued `<task-notification>` naming its id and how it ended, `killed`, `completed` or `failed`.
**The transcript may end a state the hooks started, and never start one from nothing**; everything else is the hooks' alone.
So the main process reads each transcript whose session has a status, all of it the first time and then only what was added, and ends the turn as a `Stop` would when an interrupt was written after a busy or a waiting, and ends background once all the work its `Stop` listed has an end.
It also ends a waiting with busy when a refusal of the tool call (its result begins "The user doesn't want to proceed with this tool use.") was written after it and no interrupt follows: that is a prompt turned down with feedback, the question answered and the turn going on; turned down without feedback, the interrupt follows within milliseconds (measured) and ends the turn instead.
To know what still runs after an interrupt, the script keeps each `Stop`'s payload beside the status, as `<id>.stop`, since the next turn's busy overwrites the status itself; a fresh start keeps `{}`, and a compaction keeps what was there.
Work that `Stop` listed, and a shell, a monitor or a subagent the interrupted turn sent off in the background (each one's tool result carries the id `Stop` would list it under), still run unless an end was written for them after that `Stop`: background work survives an interrupt, and its end starts a turn of its own (measured with shells, and taken to hold for the other two), so the session reads background until then.
An end written before the `Stop` does not count, since claude can reuse an id, as for a subagent resumed after it finished; a list the app reports itself keeps the time of the `Stop` it was taken from, so work stopped while the app was reporting it still counts as ended.
Any other kind of work started in the interrupted turn itself is not counted, since none was measured, and the session reads idle until that work's own turn; a monitor is known by its whole result, since other tools' results, a workflow's among them, carry a task id too, and one on a websocket, whose result is the same, is counted as a shell where its `Stop` would say monitor.
A finished shell and a subagent stopped from `/tasks` each started a turn of their own, its `UserPromptSubmit` 85 to 136 ms after the notice (three measured), so every end, an interrupt's too, waits a second for a hook to answer it, and is reported only if none has written the status meanwhile; the transcript is read again after the wait, so what claude wrote meanwhile, such as the interrupt after a refusal, counts.
The end goes through the hook script, run as the hook would have been, for an idle as for a `Stop` with the work still listed, so the script stays the one writer of the status files and the end reads exactly as the hook's would; the file names `transcript:interrupt`, `transcript:task-end` or `transcript:refusal` as the event.
Each end also names the statuses it ends and the second the status it read was stamped with, and the script, as the last thing before its write and with builtins only, writes nothing over any other: a hook that wrote meanwhile, a `Stop` above all, keeps its word, unless it lands in the few microseconds between that look and the write.
A waiting written after the interrupt is taken as a question claude asked since, and stands; whether claude still sends a prompt's notice, about six seconds late, after Esc has dismissed the prompt is not measured, and such a notice would leave waiting until the next hook.
A hook that rewrites the same status within the same second, such as a prompt's busy over busy just after an interrupt, is still overwritten, until its next tool call or its `Stop`.
Claude's idle notice did not follow an interrupt during a tool or while it wrote in the 80 seconds watched after each of three (measured on claude 2.1.289), so the idle such an interrupt leaves stays idle; after Esc at a permission prompt only 11 seconds were watched.

Two more events are not that simple, and both cost a wrong guess to work out.

**Compaction is work, so it reads as work.**
`PreCompact` → busy, and the END of a compaction is a `SessionStart` carrying `source=compact`, which the script rewrites to idle.
`PostCompact` looks like the obvious end signal and is not used: a probe never observed it firing and could not prove it ever does, while `SessionStart` was observed.
That follows from what the states mean here — **idle is "finished something, and your input is required to continue", not merely "not busy"** — so a session thinking about its own transcript is busy, and green when it comes back.

**A model switch is neither, so it gets its own file.**
A transcript records which model *answered*, never which one was chosen, so `/model` leaves no trace in it until the next reply — and the row went on naming the old model in between.
`PostModelSwitch` is the only place that answer exists at the moment it becomes true; its payload carries `from_model`, `to_model` and `source`, and `to_model` is written to `<id>.model` beside the status rather than into it, because the two answer different questions about the same session.
The renderer prefers it over the transcript's and keeps it **in memory only**: every switch in a session this app runs lands there, so it can never be staler than the file, and after a restart the transcript's own last answer is the right source again.

**`SessionStart` is mostly identity, not state.**
Its session id is what the terminal is running *now*, which is the only way to follow a `/clear` (below).
For every source but `compact` the script writes an identity-only marker that the renderer applies to the tab and never shows as a dot, and it refuses to overwrite an existing status file — these files seed the dots at launch, and the event also fires mid-session, where a real status is worth keeping.
For the same reason that marker is dropped when the launch state is read back: identity is answered by the tabs being restored around it, and seeding it would hand the renderer a status no dot has wording for.

**`SessionEnd` ends the session it names, every time — including `clear` and `resume`.**
Those two leave the *process* running, which makes them look like exceptions, and one was written here on that basis and reverted the same day.
This app tracks **sessions, not processes**: `/clear` writes a last line to the old transcript and opens a new file under a new id, so the id the event carries really is finished, and declining to close it leaves a dead session showing a live dot for good.
The process's next session arrives separately, as the `SessionStart` above.

The general shape, for any hook added later: **ask what the event means for a SESSION before mapping it to a state.**
An event named for a lifecycle is not necessarily about the lifecycle you are tracking.

The cleanup of hooks an older version injected into `~/.claude/settings.json` scans every event in that file rather than the ones this version registers, so an entry for an event since dropped is still found.
A hook also has about a second to answer before Claude Code moves on, so it must never wait on anything: answer, then finish detached.
The script is covered by tests that run it the way Claude Code does — argument, JSON on stdin, `CLAUDE_UI` set — because it is the one part of the app that executes outside it.

The hooks are scoped to claude-ui: it sets `CLAUDE_UI=1` on the terminals it spawns, and the hook script no-ops unless that variable is set, so sessions run in a plain terminal are left untouched.
When it does fire, the script writes `~/.config/claude-ui/status/<id>.json`.
The main process watches that directory and pushes updates to the renderer, which shows a dot per session: busy, idle, working in the background, waiting, or hollow (`closed` and unknown states have no color).

A session's status is forgotten, its file removed, when its tab is closed, when its tab goes cold because its claude has gone, and when a cold tab is paused, so a paused session never nudges from a status a file kept.
The second is for a claude that never reports its end: a `SIGKILL`ed one cannot run its `SessionEnd` hook, and its last busy or waiting went on nudging from the session's dot and from the roll-ups over it, such as its project's in the switcher.
A `SessionEnd` that does arrive writes `closed`, which draws the same hollow dot as no status at all.

## App-side metadata and session groups

Everything the app knows that Claude Code doesn't — pins, archived sessions, open tabs, per-project display names, custom groups, the window's geometry, the sidebar's view state and where the layout was left — lives in a `meta.json` under the app's own user-data directory.
The app's own preferences are not there: they are what you chose rather than where you left off, neither should be able to reset the other, and they are yours to edit and share, so they live in the config folder (see The config folder).
They were kept in `meta.json` as `settings` until then; `moved` records each thing that has moved out, so the move is made once, and the old copy stays where it was for an older build to find.
The session store is never written to: `~/.claude` is read-only as far as this app is concerned.

Writes are serialized through one queue and land via a temp file renamed over the target, with the previous good copy kept as a backup, so a crash mid-write can't leave the file half-written.
Reads are tolerant by design: unknown or malformed entries are dropped rather than trusted, and older field names are still understood, so an older `meta.json` upgrades in place without a migration step.

## The store

The window's shared state goes in one store (`src/renderer/state/store.ts`) that tells its readers when it changes.
It exists because the same state is drawn by the session list, the switcher, the tab bar, the live strip and the panels, and a change made in a handler that knew about one of them left the others stale: three such bugs in one day, and then the open and live filters not following the tabs.
A reader subscribes a repaint to the slices it reads and is handed a view typed as only those, so a repaint that reads a slice it did not subscribe to does not compile; a handler reads the whole state, since a click needs whatever is newest.
A repaint that reads a slice another watcher keeps current names it as read without being told — the session list reads every row's status and every section's fold, and a status change repaints only the dots, a fold only the sections — so not being told is a choice written at the subscription rather than a read nobody noticed, and nothing repaints more than it needs to.
Telling is synchronous, because some flows render and then measure — unfold a group, then scroll to its heading — and `batch` holds it to the end of a group of changes, so a read of several slices repaints once.
A slice's equality decides whether its readers are told, never what is stored, and a watcher that changes state while being told is not re-entered: what it changed is told after the round.
A watcher that throws is thrown again on its own from a microtask, an uncaught error of the window that reaches the log, rather than into whoever set the state: a repaint's failure must not cut short the flow that wrote, such as a tab's start before it binds its terminal.
A watcher is also handed its slices as they were at its last call, one that has not changed by its equality handed as it is now, so a repaint that draws only what moved compares the two instead of keeping a copy of its own: a copy compared by identity took an equal new filter, stored without telling, for a new one, and sent the list to its top.
A read from main is written as of the moment it asked (`stamp`, then `set` with `readAt`), because its answer can land after something newer: a slice written since with anything newer is left as it is, and what the read does write is as new as its asking, so a read asked later still wins whichever lands first.
Without it, the read after a delete, asked before a status event landed, wrote the older statuses back and toasted a busy session as finished; and the listing cannot instead just skip whatever was written meanwhile, since the trash moving a transcript sends a refresh of its own, which may have read the disk before the move was done.
Start-up's read is the exception, written whole: nothing can have written those slices before the first draw but a status event from a claude a crashed launch left running, and leaving start-up's statuses out for it would cost every other session's.
The store holds state and nothing else: a change main keeps is written by the action that makes it, as before, rather than by a watcher that would also write back what start-up had just read.
A watcher never writes back what it was told; one that takes a decision of its own writes it the way the action would, as the switcher falls back to All when the project on show has nothing left, exactly as choosing All does (`fallBackIfEmptied`).
A write two surfaces make leaves the first surface for `state/` when the second appears — the group writes (`state/groups.ts`), the status writers (`state/statuses.ts`), the project on show (`state/project.ts`) — so both make it the one way; a write only one surface makes stays with it, beside its menu or its dialog, until a second needs it.
The sidebar's view — the filter, the folds, the filter panel and the strip — is the one exception, saved by a watcher of its slices: it is one object written whole, on a debounce, and only when it differs from what was last stored or restored, so what start-up read is never written back (`view-saving.ts`, with the sidebar's part in `sessions/stored-view.ts`; the layout tree keeps its own, in the app's file beside the layout, see Panel state).
It comes back in the start-up read's own change, beside the listing, so the first draw is already the view you left, and saving starts only from there.
A tab is split along that line: what the surfaces draw of it — its session, its process, where it is in starting and stopping — is the store's, under the tab's token, and its terminal, the xterm and its element, stays with the terminal area under the same token; every step of a tab's life takes the token and reads the tab as it is at that moment.

## The log

An installed build is started from a launcher, so it has no stdout: the log is where what a launch did can be read afterwards, on somebody else's machine.
The main process writes it (`src/main/log.ts`), and the window's own lines reach it through the preload bridge, checked on arrival: a known level, an area that is one short lowercase word so no area can forge a line, text only, cut at 4,000 characters.

**One file per launch per date**, in `app.getPath('logs')` — `~/.config/claude-ui/logs` on Linux, `~/Library/Logs/Claude UI` on macOS — named by the local moment it started, `claude-ui-20260928143012.log`.
Each opens with a header: its own path, the version, how the app was installed, the OS, the Electron and Chromium versions and, on Linux, the display variables.
A run that crosses midnight starts a new file on its first write of the new date — a write rather than a timer, which cannot be trusted across sleep — and that file repeats the header and names the one it continues, so every file stands on its own.
One shared file per date was rejected: a crash in the morning and a clean launch in the afternoon would share it, and a file can only be kept whole.
The folder is read in `paths.ts` below the `userData` pin and nowhere else, because the call creates it as a side effect, and on Linux, made before the pin, it resolves under the product name and leaves a stray `~/.config/Claude UI/logs` behind.

**There is no size cap.**
The date roll keeps a file readable and loses nothing within a run.
Rejected: cutting the middle out at 2 MB, rolling to part files, trimming the oldest lines as the audit log does (which loses the header, the lines that say what build this was), stopping at the cap (which loses the end, where a crash is), and a hard ceiling as a backstop.
What bounds the likeliest runaway, an error thrown on every frame, is that identical lines in a row collapse into one line and a count, and the count is written within five seconds, so a crash in the middle of a flood still leaves it.
A failure met on every pass of something that repeats — a transcript that cannot be read, at every listing — is written once per file instead, since other lines come between the repeats.

**Retention** keeps the files of the 7 most recent dates that have a log — dates with one, not calendar days, so two weeks away does not empty the folder — and runs whenever a file starts.
The numbers live in `src/shared/log.ts`, because Settings states them.

**A crash log** is a file whose launch did not end with its quit line, or in which a process of the app died: an uncaught exception or unhandled rejection in main, the renderer gone, the GPU process gone.
It is renamed `…-crash.log` and kept apart, the 20 newest.
From the inside, a native crash, a kill, a WSL shutdown and a power cut look the same, so the next launch appends "this launch ended without quitting" to the file rather than a guess at why; it only checks the newest ordinary file, which is the previous launch's last.
Only the file where it happened is marked, not every file of a run that lasted several days.

**Deleting the logs while the app runs is safe**, since Settings invites it.
Writes go by path, with `O_APPEND` and no `O_CREAT`, so a file that has gone is noticed rather than silently recreated without its header, and the line that noticed starts a new file the way midnight does.

**Uncaught errors are observed, not handled.**
The log listens on `uncaughtExceptionMonitor`, never `uncaughtException`: Electron shows its "A JavaScript error occurred in the main process" dialog only while it is the one listener for the latter, so a listener here would take that dialog away in silence.
The monitor also receives unhandled rejections, which Node raises as uncaught exceptions, and a test pins that the listener count does not change.
The window's uncaught errors arrive through `console-message` as `Uncaught …` lines — measured, not assumed — so forwarding its warnings and errors is its crash reporting too.

**What is written**: each terminal's start, with its pid (which the SIGKILL line names), its stop and its end; panel runs that fail; the layout file's state when it changes; a folder that cannot be watched, when the reason is anything but "not there"; which copy of `meta.json` the app went on with when it had to recover one; git missing or timing out; the GPU status whenever it changes; and which renderer the terminals draw with.
**What is not**: prompts, transcript text, session and worktree names, the value of a flag, a panel's command line or its output.
The one exception is a failed start's last five lines, which for a resume that dies at once can include some of the history it had just drawn.

## Panels

A layout file arranges the whole window: rows and columns of panel groups, with the sidebar and the terminal area as two of the panels.
Per-project and named layouts are the next steps of the same design, and the file's shape leaves room for them.

### The config folder

Everything a person may edit or share lives in ONE folder, `config/` under the app's data directory, and nothing else does: the settings in `settings.json`, the layout file at `layouts/default.json`, the scripts it points at under `scripts/`, and panel types of the person's own under `panel-types/`.
It sits apart from `meta.json` and the status files on purpose.
Those are machine state the app writes, which nobody should edit and nobody would want to hand a colleague; this folder is the opposite on every count, so "copy this folder" hands over exactly the customisation and none of the state.
`layouts/` is a directory rather than a single `layout.json` so that named and per-project layouts can be added beside the default instead of by moving it.

Every file in it is JSONC, the format of VS Code's settings: JSON that may also carry comments and trailing commas, so a plain JSON file reads unchanged and a person can say in the file why something is there.
It is read in one place (`src/main/jsonc.ts`, on `jsonc-parser`), for the settings, the layout and every type's manifest alike.
That parser reads on past a mistake and hands back what it could make of the rest, which is not what anybody wrote, so any error at all means the file does not parse, and only the first is named, by line and column: the ones after it are mostly its echo.
What decided it over JSON5 and YAML is that the same parser changes a value in a file as an edit of its text, keeping every comment around it, which was tried before it was chosen; YAML is a much larger format besides, with indentation that means something and words like `no` that read as false.

**A file a person writes is theirs, and the app never writes it.**
Where the app has something to keep in the folder, it goes in a file of its own beside the person's, named like it with `.local.json` (`settings.local.json` beside `settings.json`), and the app's file wins, the way Claude Code's own `settings.local.json` wins over its `settings.json`.
Two files rather than one the app rewrites: a file somebody has open in an editor is never changed under them, what they wrote is still there to go back to, and a value saved in the app never travels in their file.
The app's file holds nothing secret, only what was chosen in the app on this machine, so it may be shared too: "yours" and "the app's" say who writes each, not which one leaves the machine.
Every write goes through one module (`src/main/appfiles.ts`), which refuses any path but a `.local.json` inside the folder, so that rule is held by the code rather than by whoever calls it.
A write is an edit of the file's text (`jsonc-parser`'s `modify`), never a rewrite of its value, because a person may edit the app's file too: changing a value keeps every comment and the formatting, a key added to an object written on one line spreads that object over several, and a key removed takes a comment at the end of the line before it along — all three measured, and the last two are why a person's file is not edited this way either.
A file of the app's that a person has left not parsing is not written over: the write is refused, saying where the file goes wrong.
Each write keeps the previous good copy, and the file as the outgoing version left it the first time a new version writes, in `backups/config/` under the app's data directory rather than in the folder, which holds only what a person writes and the app's own files; which version last wrote each file is kept there beside its copies, since a `.local.json` carries no version of its own.

The settings are the first such pair, read by `src/main/settings.ts` by rules main and the window's checks share (`src/shared/settings.ts`): a setting reads the built-in default, then `settings.json`, then `settings.local.json`, and the last that has it wins.
Settings saves into the app's file, and a value equal to what would be in force without the app's takes the app's away rather than copying it, so a later edit of `settings.json` is never hidden behind a value that only looked like a choice.
Where the app's value wins over the person's, Settings shows theirs under the field with a button that goes back to it, the same act as a divider's double-click going back to the layout file's sizes: the app's value wins, and where you would look, it says so.
A mistake in either file is named in Settings, under the setting it concerns or, for the file as a whole, under the section; the log says what is wrong without a flag's value; and a file that does not parse keeps what it last read in force, as the layout file does, and is toasted until it parses.
Both files are read afresh whenever asked for, a session's start included, so an edit counts from the next session on.
The launch flags were kept in `meta.json` before; the first launch that has the folder moves them into `settings.local.json`, once.
The layout's sizes, folds and picks are the other pair, in `layouts/default.local.json` beside the layout (see Panel state).

A command in a hand-edited file is the user's own, and a trust step arrives with the first thing that lets a command reach a file by another route than their editor, such as an editor in the app.
A type folder a colleague shared was decided (2026-09-29) to need none: it runs as you, the way a script in `scripts/` does, and what makes that acceptable is that a type can do nothing beyond running its script without being pressed (see Types from the config folder).
A `settings.json` from somebody else was decided (2026-10-05) to need none either, its launch flags included, though they reach every session you start without a press: what a shared settings file says is for its reader to check, as it is with Claude Code's own, and Settings shows it.
The settings dialog shows the folder's path with an Open button, which is the whole of the UI for finding it.
It opens the folder itself (`shell.openPath`) rather than showing it selected in its parent (`showItemInFolder`): a Linux file manager without FileManager1 support, which is what WSLg offers, opens the parent and selects nothing, which reads as the wrong folder.

Directories are watched one by one rather than the folder recursively (recursive watch is unreliable on Linux and WSL, as the session watcher found): the folder, `layouts/`, `scripts/`, `panel-types/`, and each type's own folder.
An event on the folder itself re-opens the ones below it, because a directory deleted and recreated leaves its old watcher pointing at nothing, and an event on `panel-types/` re-lists the type folders, so one added there is watched from then on.
`scripts/` is watched so that a script appearing, or gaining its executable bit, clears the panel's error without a restart; that an attribute change reaches a directory watch was measured rather than assumed.
The events over the watch's debounce are gathered with the paths they name, and when every one was the app's own write to one of its files, as it left it, nothing is pushed (`ownWrites`): the window already has what the app wrote, and a push would have every panel check its options again for nothing.

### The layout file

The file is ONE TREE, and the app's own surfaces are nodes in it: `{ "version": 2, "root": … }`, where every node has an `id` and exactly one of `rows`, `columns` or `panels`.
A node with `rows` or `columns` is a split; a node with `panels` is a **panel group**, which shows one panel at a time.
"Panel group" is the layout's word, and a plain "group" stays the session list's (see UI conventions); the two are unrelated.
The first shape of the file, one panel beside the terminal, never shipped, so version 1 is refused with a notice rather than converted.

A panel is an ENTRY in a group, not a file of its own: `{ "id": "status", "type": "command", "options": { "command": "git status --short" } }`.
**The layout reads the layout, and a panel reads its own options.**
`id`, `type`, `title`, `hidden` and `icon` are the layout's, and it checks them; `options` is the type's, handed over whole and read by nothing else (see A type owns its options).
The nesting is that rule made visible in the file rather than kept as a list of names the layout holds back: a field the layout gains later can never collide with a type's setting, and an unknown key is named by the side that owns it — the layout for the entry (`"tilte"`), the type inside `options` (`"comand"`).
Entries used to be flat, the shape of Claude Code's statusline and hooks, so that a line could be pasted from one file into another; in practice that saved one line, and it made every future layout field a name no type could use.
Grafana's panels, the nearest thing to this file, nest theirs under `options` too, which is where the name comes from.
Every id, of a node or an entry, is a slug the user writes (lowercase letters, digits, hyphens and underscores) and unique across the whole file, because ids are what the window's state keys on: dragged sizes, folds, the panel picked in a group.
The app assigns nothing, because it writes nothing.

The tree is hand-built from flex containers rather than taken from a docking library.
What it needs — splits, dividers, a rail, folding — is small and already in the app's own vocabulary; what a library is for, dragging panels between groups and floating them, is deliberately not wanted, since the file is the editor.
The file stays engine-agnostic, so a library could replace the renderer later without a layout changing.

**Every mistake in the file is named, in the place of the thing that is wrong, and nothing is dropped or guessed.**
This is the opposite of meta's rule, and for the opposite reason: meta drops what it does not understand because the app wrote that file and a past version's field is noise, while this file was written by a person, so what the app does not understand has to be said back to them or they go looking for the bug somewhere else.
A node whose own fields are wrong — none or several of `rows`, `columns` and `panels`, an empty list, a size it cannot read, a field it does not know — becomes a degraded group in its place, listing every problem rather than the first.
An entry's problems show in its slot, and a mistake that is no reason to refuse a panel, such as an icon the app does not have, is a note under the group instead.
A key the layout does not know on an entry is refused with a sentence saying a type's own settings go under `options`, worded without knowing any type's options — which is also the whole notice for a file from before they were nested.
A file that cannot be read as a layout at all — not an object, another version, no root — keeps the default window and adds one degraded group beside it saying why, so the window stays usable while the file is fixed.
A file that does not parse keeps the last good layout up and toasts the file, what is wrong and its line and column until a read succeeds.
The validator (`src/renderer/panels/layout.ts`) is pure and tested per rule, including every refusal, so a validator that accepts everything fails its tests.

**The default layout lives in code, never on disk**: the sidebar at 320px beside the terminal area.
It is what a missing file means, and what an unparsable one means before any good read, so there is always a way back to a window that works — a file could be moved, deleted or renamed, and the default cannot be.
It goes through the same validator as any file, and a test pins that it resolves without a word said.

### The app's own surfaces are panels

Two built-in types exist: `sessions`, the whole sidebar (switcher, actions, filter, list, live strip), and `claude`, the terminal area (tab bar and terminals).
Each is ONE element for the run, moved into the group that places it and parked in a hidden holder if the layout lets go of it — never rebuilt and never disposed, so a layout change keeps every running session and its xterm exactly as they were.
A change that remounts its entry, a new id or an option, puts that same element back, so a built-in needs no hook of its own for its options: its mount is handed the entry as it now is.
Each is a type of its own, in a folder of its own with its stylesheets: the terminal area in `src/renderer/panels/types/claude/` (the tabs' terminals, the pane, the tab bar, the history and the attention toasts), and the sidebar in `src/renderer/panels/types/sessions/` (the switcher, the filter, the list, the live strip, and the part of the stored view that is the sidebar's).
Each builds its markup when its modules load rather than on its first mount, because its surfaces read their elements as they load; the tree mounts both as it first draws, so nothing would change if it waited.
Each part builds its own as its module loads, through `fromMarkup` and `byId` (`dom.ts`) — in the sidebar the switcher, the filter, the list and the strip, in the terminal area the tab bar, the terminals and the pane — and the type's `index.ts` puts them together, the sidebar's with the header's two buttons that are the type's own, so no part reads an element it did not build, and the imports run one way, from the whole to its parts.
The sidebar's list is itself several modules, each with its stylesheet, over one that holds what is on screen by key (`drawn.ts`): the draw and its watchers (`list.ts`), the sections and their headings (`headings.ts`), the rows (`rows.ts`), the new-session button a project's heading and a group's both carry (`controls.ts`), the menus and the writes they make (`actions.ts`), the folds and collapse-all (`folding.ts`), bringing something into view (`reveal.ts`), and the full read from main (`read.ts`).
None of them imports the draw, which is what lets a menu sit apart from it: every fold is a write of the store's `folds`, which the list's own watcher draws in place (`foldsFollow`), so a reveal, collapse-all or a new group's jump only writes and then measures, where each used to draw the whole list itself.
What is about the whole area is the whole's: the history's Ctrl+Shift+↑ and ↓ are caught in `claude/index.ts`, which knows where the terminal area ends, and the pane does the stepping (`stepHistory`).
Both are made by one factory (`builtinType`, in `panels/types/builtin.ts`), so the re-attaching mount is written once rather than in each: it puts the element back, and hands the new host the type's rail status as it is now (`railStatus`), since a remount is a new host; after that, a watcher of the type's own hands its host every change.
Its being a singleton is said there, where the type is, rather than special-cased in the tree, which drives a built-in exactly as it drives any panel.
These two are the only singletons, for the reason above: what runs in them has to outlive any layout.
Every other type, `command` and `terminal` among them and any built-in added from here on, is an ordinary one: an instance per entry, built by its `mount`, its store watchers, if it has any, taken there and dropped in `unmount` (`store.watch` answers the unsubscribe), and its asks made through the host its mount was handed rather than `hostOf`.
The two ask each other through the host every panel is given (`Asks`, in `panels/contract.ts`, the contract every type is written against), the same route a list panel's row takes to open or start a session: the terminal area answers opening a session or just its tab, starting, forking, stopping and closing sessions, and showing a project's tabs; the session list answers selecting a project and bringing a session, a project or a group into view.
Each type's answers are one object in its `asks.ts`, which `renderer.ts` hands the tree, and every panel's host carries them as they are, so an ask is the answer itself rather than a hop through the tree; a surface never imports the other type's modules: what they share is the store and these asks.
An ask names a session by its id or a project by its folder, never a tab by its token, which is the terminal area's own; a built-in reaches its host outside a mount by `hostOf`, and none can ask before the tree has placed both, which it does as it first draws.
What is left in `renderer.ts` is the start-up: the order the watchers are registered in, the store telling them in that order, the bridge's events into the store, the tree, and the order the window comes back in.
Each built-in registers its own watchers (`panels/types/*/watch.ts`), its rules, which set state as they are told, apart from its repaints, and `renderer.ts` places the blocks: both types' rules before any repaint, since no order across the two types matters (measured in 08a6ac4); the list's watchers name each slice once, beside it (`watchList`).
The terminal area's part of what main sends is a handler `renderer.ts`'s one subscription per event calls first, so a cleared session's successor is the tab's before its status is set.

Both must be placed exactly once, and the rule is the validator's rather than the DOM's: **no layout file can produce a window without the terminal.**
One left out is added — `sessions` as the root's first column, `claude` as its last, wrapping a root that is not columns — with a note saying so; a second copy stands in its place saying where the first one is; `hidden` on one is ignored, with a note.
An entry for one that has a problem does not count as placed, so a working one is added and the broken entry stays where it was, saying why.

Both are BARE: each carries its own top bar, so it gets no header of the tree's.
The tab bar is not a panel of its own but the terminal area's own strip.
The sidebar's width from before it was a node is adopted once into the tree's state, so an existing install keeps its sidebar.

### Sizes

A node's `size` is a SHARE of its parent (a number) or PIXELS (`"320px"`).
A pixel node keeps its size when the window resizes, and the shares divide what the pixel nodes leave: the unsized children share what the shares leave of 1 equally, and shares on every child are plain proportions.
When the shares leave nothing, each unsized child is weighted as their average, with a note — a built-in the validator adds lands here, and a terminal squeezed down to its `min` would be no window at all.
In a narrow window a pixel node gives way once the others are down to their `min`, rather than the window's edge being cut off.

A share is a flex weight, and a size dragged to is kept PER NODE IN ITS OWN UNIT, over the file's: a pixel node's as pixels, a share's — or a node's without a size — as a share, so a share keeps scaling when the window resizes, the fold edges (`foldEdge`), which read pixels against flexible, never move, and keeping one for good is copying the field into the file.
A drag writes the two nodes beside the divider when that alone puts every flexible child where the drag left it, and every flexible child on show when it does not, which is when a share given to a node without one would change what its unsized siblings get; a lone flexible child takes what is left and is never written (`sizesAfterDrag`).
Each written share is the child's weight per px of the room it shared before the drag times what it measures now, so the sum holds and a sibling the drag did not touch keeps its place; a sweep over every mix of sizes, both dividers and widths up to 3,440 px checks every drag is reproduced within half a pixel, and shares are written to four places, which stays within that.
Kept per node, a size survives a sibling the file adds or removes, which takes what the file gives it; the one case that would go wrong — shares written for nodes without one, then a sibling added without one, which would find no share left — is guarded: the app's sizes never make your layout wrong, so where they would raise the note the file alone does not, that split shows the file's sizes, and the log says so (`withOverrides`).
This reverses the first layout plan's rule that a split's dragged sizes were kept or dropped whole, deliberately: whole, a size written into the app's file by hand did nothing unless every sibling had one.
The arithmetic lives in `src/renderer/panels/sizes.ts`, pure and tested; `tree.ts` only measures and applies.

### Dividers and folding

A divider sits between every two neighbours and is always drawn, as a hairline: two panels on the same background otherwise read as one.
It can be dragged only when both neighbours are `resizable` and neither is folded, and one that cannot says why on hover (`Fixed size: side has "resizable": false`, `Unfold drawer to resize`), so it does not read as broken.

A `collapsible` group folds from a chevron on a divider, and a group with a rail from its rail too (see Several panels in a group).
It sits there because a divider takes no room anywhere else, and won over a header row (which a bare group does not have) and over a button placed in the panel's own bar, after all three were tried in a clickable mock.
The chevron points the way the group moves, and stays on the same divider when the group is folded, turned round: fold and unfold happen at one spot.
It is FAINT until the pointer is on its divider and full then — quieter than a row of buttons on every foldable divider, and easier to find than a chevron that only appears on hover; all three were tried.
It is a thin tab centred on the divider's line, 11px across, so it overhangs each neighbour by 3px, inside their padding, and never covers a header's text.

Which divider carries it, and which way it points, follows where the space goes.
A folded group's room goes to its siblings without a pixel size, so a group in the middle of a split whose flexible siblings are all before it slides toward the END as they grow — and a chevron on its far side pointing back toward the start said the opposite of what happened, which is how the rule was found.
So the first child folds to the start and the last to the end, each having one divider, and a middle child folds away from where its space goes, with its chevron on the divider on the other side.
Two chevrons share a divider only for two foldable groups that are a split's only children, and they then sit one after the other along the line, each pointing into its own group.
They first sat one on each side of the line, which put one of them on the header below; hovering a chevron outlines the group it acts on, which is what tells two apart.
The edge is worked out from the file's sizes rather than from which siblings happen to be folded, so a chevron never moves when a neighbour folds (`foldEdge` in layout.ts, tested).

A folded group is its rail, 28px along its parent's axis.
Its size is its own, kept per node, so it unfolds to the size it had with nothing to take beforehand.
`folded: true` on a group that may fold starts it folded, until it is unfolded; on one that may not, it is a note saying to add `collapsible`.
Only panel groups fold; `collapsible` and `folded` on rows or columns are named as not honoured yet.

### Several panels in a group

A group with several panels shows one, and switches from a RAIL of icons on the edge it folds toward — the edge a folded group's rail sits on, so the rail stays where it is when the rest folds away.
It won over a tab strip after both were tried: a strip costs a row and changes shape when its group folds, and a built-in sharing a group with a strip put two rows of tabs above the terminal, where with the rail the terminal area keeps its own tab bar and gets no header.

Each type declares an icon, and an entry can pick another with `icon`, by name from a fixed set; the tooltip is the panel's title.
A dot on an icon reports a panel that is not on show: a command whose run failed, or a session waiting for you behind `claude` or anywhere behind `sessions`.
The dot is the status dot the rest of the app uses (`.nudge`), with one state of its own for a failed run.
Clicking an icon shows that panel and unfolds the group, and clicking the shown panel's own icon folds the group, as VS Code's activity bar does, so a panel is put away from the icon that brought it out.
That icon used to do nothing, which kept the chevron the one fold control; both now call the one fold (`toggleFold`), so they cannot fold a group two ways, and the icon's tooltip and its `aria-label`, one string, say it folds.
In a group that cannot fold the shown icon still does nothing, and has neither a pointer nor a hover to suggest otherwise.
A panel's own marks — the busy mark, the run's last word, its button — sit in a header over it, unless its type is bare.

The fold control and the switcher each live in one function in `tree.ts` (`foldControls`, `switcher`), so trying one of the other variants from the mock — a header button, a tab strip — is a local change there, and none of it is in the file format.

### A layout change keeps panels running

The tree is rebuilt on every layout change, fold and panel switch, but a panel never is: mounted panels are kept by entry key and moved into their new place.
A panel is mounted afresh only when its type or its `options` change (`mountSignature`, tested), so a new title, icon or position moves a running command or shell rather than restarting it, and a save that adds a panel restarts nothing else.
The signature is whatever sits under `options`, with its keys sorted, so it knows no type's options and reordering them restarts nothing.
Moving an element resets its scroll offsets and drops its focus, so a rebuild carries both across.

A panel behind another in its group, or in a folded group, keeps its DOM and its process: hiding stops nothing, and only removal from the file does.
A context change does not run a hidden `command` panel; it is remembered as a difference, and the panel runs once when shown — and not at all if the context came back to where its last run was (`RunGate`, tested).
One with an `interval` runs on it while hidden all the same (§ The `command` type).
A `terminal` keeps its shell and refits from its own `ResizeObserver` once it has a size again.

At start-up the default layout is drawn before the first paint, the file is read before a single row is drawn — so the sidebar and terminal area are moved into the tree while they are still empty — and panels are shown only once the tabs are restored, so a panel's first run is in the restored tab's folder.

### A type owns its options

A panel type is a module under `src/renderer/panels/types/`, and it declares its options in one place: name, kind (`text`, `path`, `duration` or `choice`), for a `path` what it resolves against and what it must point at, for a `duration` the shortest and longest it may be, for a `choice` the values it may be, and which groups of options are exactly-one-of.
The layout sees only what it needs to draw and place an entry: the default icon, a default title from the options where they give one, whether the type is bare, and whether it is a built-in the layout must place once.

**The type checks its own options**, with one checker every type shares (`panels/options.ts`), driven by that declaration: a key it does not know, a missing or doubled exactly-one-of, a value that is not a string or is empty, and what a path points at — the last asked of the main process, which has the filesystem.
It checks when it is mounted, so a panel behind another already wears `alert` on its rail; before every run or shell start, since a script can go missing between runs; and whenever the config folder changes, which is how a script gaining its executable bit clears without a restart.
It says what it found through its HOST, the tree's side of a conversation that already carried the busy mark, the run's last word and the rail dot: "cannot run, because …" is drawn with the same problem list the layout's own refusals use, with `alert` on the rail icon, and a note goes on the group's note line.
`alert` is "will not start as its options stand"; the red dot is still "a run failed".
A built-in reports what it does not understand as notes, never as problems, because no file may produce a window without the sidebar or the terminal.

It was the other way round at first — main checked every `script` in the file when it read it, so one read named everything — and it moved for two reasons.
A path relative to the selected project, which the `cwd` option needs, changes while the app runs, so no read of the file can answer it; and a layout that knows a type's option names is a layout every new option has to touch.
The cost is that a missing file is named when the panel checks rather than in the same read as the file's shape: the same place on screen, a moment later.

The type also owns its panel's body and its run; the tree (`tree.ts`) draws only what is around it — the header, the rail icon and its dot, the dividers, and the problems a panel reports.

### The `command` type

It runs something and shows what it printed, and it takes its command in one of two ways, exactly one required.
`command` is a command line, run by a fresh copy of the user's shell as they typed it, so pipes and quoting are the shell's business.
`script` is a path to an executable, relative to the config folder, absolute, or under `~/`, passed to the shell as ONE argument with no parsing of the path, so a space in it is nothing.
The type kept the name `command` for both: a one-liner is not a script and a script is not a command line, and Claude Code's statusline and hooks say `"type": "command"` for either.

A script resolves against the config folder ONLY, never the selected project, deliberately: a project-first lookup would change which code runs, not where — a repo with a file at the same path would silently replace yours, and since a panel runs on show and on a project switch, selecting a freshly cloned repo would run its executable unasked.
A project's own script is reachable, explicitly, as `"command": "./bin/status"`, which the shell resolves in the context directory.
The resolver is one function in main (`resolvePath` in `config.ts`) used by the panel's check and by the run, so the two cannot disagree about which file was meant.

The command runs in the panel's CONTEXT DIRECTORY — the active tab's cwd, else the selected project's repo root — so a worktree session's panel reports the worktree.
That is the one thing that differs between the two forms: a relative path INSIDE a command line is resolved by the shell against that directory, while a relative `script` resolves against the config folder, so the script travels with it.
The context reaches the command as environment variables only for now (`CLAUDE_UI_PROJECT_ROOT`, `CLAUDE_UI_CWD`, `CLAUDE_UI_SESSION_ID`, `CLAUDE_UI_CONFIG_ROOT`); JSON on stdin joins when a second type wants it.
With neither a tab nor a project the panel says "Pick a project to run this in." and runs nothing.
It runs when first shown, on Refresh, and when its context changes, which a tab switch, a project switch and stopping the tab you are on all do, and so does the tab's own session changing under it, on a `/clear` or a move into another folder — but a context change never runs it while hidden (see A layout change keeps panels running).
It also runs on its `interval`, if it has one.
When it runs, the check before each run, each run's token, and asking main to run and to stop are one piece that this type and the list kind both go through (`PanelRuns` in `panels/runs.ts`, over the `RunGate`), so the two answer them by the same rules; each panel says only what it checks, what it runs, what it draws at each step, and the interval it runs on.

**An interval runs it out of sight too.**
`interval` is the list kind's own declaration (`INTERVAL_OPTION`, ten seconds to a day), read through the same helper (`intervalOf`), and its timing is the list kind's too, through the same `RunGate`: a tick that long after each run ends, hidden or folded as well, and a first run when the tree first places the panel, shown or not.
So "does a panel's interval run out of sight" has one answer for both; here it keeps the rail's red dot true, where the list's reason is its count.
The alternative was a run on show when one is due and none while hidden, which makes an hourly overview late by its own run time each time it is looked at.
The gate counts the next tick from the end of the latest run it let through, and every run clears a tick still waiting, so no tick starts while the latest run goes; a run whose check finds problems sets no tick, and the ticks start again when a later check finds the panel can run.

**A tick holds what is on show.**
A run the interval's timer starts writes into a fragment out of sight, and the output on show stays as it was, with the header's word and the dot, until the run ends, with only the busy mark saying a run is going; then the fragment's text takes the output's place, whether the run failed or not.
The swap fills the same element, so the scroll stays where it was as far as the new output reaches.
A press and a switch still clear the body and show the run as it prints, as they always did: a press is asked to be watched and a tick is not, and clearing on every tick would empty the panel and send it to the top unasked.
Holding on a press too is the list's answer, which keeps its list through every run that has somewhere to run; it was not taken, since it changes what Refresh does and nobody asked for that.
Output a run left hidden, having found nowhere to run or that the panel could not run, is not held: it is from before that, and a tick starts afresh like a press.

**A tick that fails shows what it printed**, as a failed press does: a command's failing output is usually what it has to say, where a list's broken document has nothing to show.
The list's rule, the last good output kept under a line saying the run failed, was the alternative; keeping the last output only when the app cut a run short (30 s, 1 MB) is the one to take if such stops turn out to be common.

**A run can say when it runs next.**
Every run that starts gets a file of its own, named in `CLAUDE_UI_CONTROL`, unless the file cannot be made, which the log names; the run may write `name=value` lines to it; main hands the file's first 4 KB over on the run's end, as written, and the window reads it (`readControl`, tested), so what a run may say has its rules in one place, beside the one duration parser.
`next` is the delay for the next run only, in place of the interval or without one, or `off` for none; a run that says nothing leaves the next run to the interval, so a script that stops saying it never leaves behind an interval the file does not show.
It is held to the interval's own bounds, ten seconds to a day, read from the one declaration (`INTERVAL_OPTION`): a `next` outside them runs at the bound it crossed, with a note, where an interval outside them is refused, since the layout file is fixed by editing it and a run's word is gone by the next run; `0s` is no duration in either.
A line, a name or a last `next` the app cannot read is a note on the group's note line, beside the panel's own notes; every run's end replaces those notes with what that run's file got wrong, and a run that cannot run or finds nowhere to run clears them.
A run the app stopped itself as it quit says nothing, as the list kind already reads such a stop.
It is a file and not a marker in the output because what a panel prints is often somebody else's text, a PR title or a log line, which could carry the marker; GitHub Actions deprecated `set-output` on stdout in favour of such a file for that reason.
The file is made in the system's temp folder, exclusively and readable by the user alone, since on Linux that folder is shared with every user, and removed when the run's end has been read; a crash, or a quit in the second a run's end can take, leaves it there, empty or nearly.

**`watch: git` runs it again when its working tree changes.**
The working tree is git's view of the folder the panel runs in and everything under it, asked of git rather than watched file by file: one watch per directory, skipping a fixed list of heavy folders, measured 44,287 watches and 160 MB on a large repository, and Node's recursive watch takes one per file and per directory, past the system's limit there unfiltered; `git --no-optional-locks status --porcelain=v2 --branch --untracked-files=all` there took 0.07 s.
Main gives a fingerprint of it (`src/main/gitstate.ts`): what `git --no-optional-locks status --porcelain=v2 --untracked-files=all` lists under the folder, the size and time of each listed path, so a second edit of a file already changed counts, and the folder's own tree at `HEAD`, so a commit or a checkout counts only when it changes that folder, where `--branch` would have counted one anywhere.
`--no-optional-locks` keeps the look from refreshing the index, which a plain `git status` writes after a change while holding its lock, where the person's own git could fail on it; ignored files never count, by git's own rules.
`PanelRuns` looks 30 seconds after its last look answered, from when the tree goes live and out of sight too, as an interval's tick runs, through the panel's own check, so the folder is the one it would run in now; not while a run goes, nor while the panel cannot run, and what such a look finds wrong it keeps to itself, for the next run's check to say.
A change runs the panel once the next look finds the same fingerprint, so a burst of writes with no run between is one run, 30 to 60 seconds after the last; it is unasked, and holds what is on show as a tick's run does.
The fingerprint to compare against is taken when a run ends, and no look counts while one goes, so what a run writes itself runs nothing, and nor does what anyone else changes meanwhile; it is kept per run by number, so the end of a run a newer one replaced neither counts nor sets it.
It is for the folder last seen, and a look in another folder takes that one's fingerprint and runs nothing: a switch is a switch, which the gate answers as it always did, and not a change.
A folder in no working tree is a problem that stops the panel, since the option has nothing to watch there, with a word that Refresh looks again; git not answering the panel's check is one too, in git's own words, but it may answer later, so the panel asks again every 30 seconds, three times, saying which, and then stops asking until something looks again.
Only a look that is not a timer's starts those retries afresh — the panel's mount, Refresh, a reveal, a push from the config folder, a switch that runs the panel — and not an interval's tick, a change's run or a retry's own look, nor the redraws the tree makes, which is why a panel that cannot run looks again on coming into view and not on every redraw.
The alternatives were a watch of the folder (above), a run when a session in it ends its turn, which misses an editor's edits, and looking only while shown, which would leave the rail's dot stale; the period was the person's choice, 30 seconds over 2.

### Where a panel runs: the `cwd` option

Both the `command` and the `terminal` type take a `cwd`, one declaration (`CWD_OPTION` in `options.ts`) and one rule (`placement` in `panels/run.ts`, tested), because "where does this panel run" is one question with one answer on both.
Without it, the panel runs in the context directory.
An absolute or `~/` value is FIXED: that folder whatever is selected, so it runs with no project at all.
A relative value is under the context directory, so `"cwd": "packages/api"` follows the project into its subfolder — and a worktree session's panel into the worktree's copy.
The folder the run uses is the one main's check resolved, so the run goes exactly where the check looked, and `CLAUDE_UI_CWD` names it; the project and session variables are the selection at the moment of the run, empty when there is none.

A relative `cwd` resolves against the project and never falls back to the config folder, which was considered: the same file would then run in different places depending on which folders happen to exist, and a typo in one project would silently become a folder in the config directory.
(`script` is the opposite way round for the reason given under The `command` type: a `cwd` only moves where your command runs, while a project-first `script` would change which code runs.)

**A fixed `command` panel does not run again on a switch**; it runs on first show, on Refresh and on its interval.
It has nothing new to read, and re-running it on every tab click would print the same folder's output again — which is what keying it on the whole context, as before, would have done, since its variables change even when its folder does not.
The run is keyed on where it goes (`runKey`, tested): the whole context without a `cwd`, as it always was; nothing that changes for a fixed one; the folder it lands in for a relative one, so a tab switch within that folder does not re-run it.
A refresh on a timer is the `interval` option (§ The `command` type), answered for every type that takes it by the one gate, `RunGate`, and not by this option; so is a run's own word on when it runs next, through its control file.

### How a command runs

**Through the same shell as a session.**
`src/main/shell.ts` holds the one login-shell invocation both use, so `PATH` is identical: the rc files that put mise, direnv and the MCP servers' tools on a session's `PATH` run for a panel too.
The command is a positional parameter of a fixed script of the app's, never interpolated into it.

**Measured: an interactive login bash without a tty prints two lines of job-control noise on stderr before anything runs (`cannot set terminal process group`, `no job control in this shell`), and `logout` on exit if it is still the parent when the command ends.**
Both are handled by shape rather than by filtering text: the spawn discards the SHELL's stderr, the script's first act is `exec 2>&1` so the COMMAND's stderr joins the one pipe — which is also what puts the two streams in true arrival order — and the command is `exec`ed in the shell's place, so nothing is left to say `logout`.
Dropping `-i` was the alternative; mise resolves without it on the machine this was written on, but the rc-based setup would be skipped and a panel would no longer see the `PATH` a session sees.

**Non-interactive, spawn and read.**
No pty: stdout and stderr in one pipe, output capped at 1 MB and the run at 30 seconds, after which the process is stopped and the panel says so.
A process that never exits by design — a dev server, a watcher — is not this panel type.
Plain text is asked for with `NO_COLOR=1` and `TERM=dumb`, and escape sequences are stripped on top for the tools that do not listen, with a sequence cut at a chunk boundary held back until the next chunk completes it.

**Stopping is the group.**
The child is spawned `detached`, so its pid is a group id, and a stop is the same SIGTERM-then-SIGKILL escalation a session gets, shared from `shell.ts`, reading whether it worked from the child's own exit.
A re-run stops the run before it, removing the panel from the file stops it, and quitting sweeps every live run down the same path; hiding it does not.
The end of the OUTPUT (`close`) and the end of the PROCESS (`exit`) are read separately: something the command started can outlive it holding the pipe, and once the leader is gone nothing may be signalled, since its pid may already belong to somebody else.

**`CLAUDE_UI` is deliberately not set.**
It is the marker the status hooks fire on, and a panel that happens to run `claude -p` must not report as a session.

**A run carries a token.**
The renderer mints one per run and every event echoes it, so output still in flight from a run just replaced never lands in the new run's body.

### The `terminal` type

A plain shell in a panel: the interactive login shell a session runs `claude` in, with nothing to run, in a pty, shown in an xterm.
Its one option is `cwd` (see Where a panel runs).

**It stays put.**
The shell starts where the panel is placed at the moment it first shows — the context directory, or its `cwd` — and stays there through tab and project switches.
A shell has state — the command you have running in it — so following the context the way the `command` panel does would kill that command on every switch, and one shell per directory kept alive and swapped like tabs is a lifecycle that belongs with groups and tabs, not here.
So the header names the folder the shell is in, the button is "Restart here", which kills the shell and starts one in the current context, and the one exception is a panel with no shell because there was nothing to run in, which starts as soon as a context appears.
The type declares that button's label itself, per entry, so the tree keeps one button and the type says what it does.
**A terminal with a fixed `cwd` has no button**: it would restart in the same place, so what is left of its purpose is bringing a dead shell back, and a key press does that (below).
One whose folder is missing says so in its place, like any panel that cannot run, and looks again whenever it comes back into view and whenever the config folder changes — with no button, being looked at is how a folder that has appeared since gets picked up.

**A shell that exits comes back on a key press.**
Its screen stays up with a dimmed line saying it exited and that any key starts a new shell, and the next key does, through the same start the button uses; the key is the ask, so it is not sent on to the new shell.
That is what VS Code's terminal does, and it was chosen over a button that appears only once the shell has gone, and over restarting on exit by itself, which would need a guard against a shell that dies at once — a broken rc file, say — starting again forever.
It exists so that getting a shell back never depends on the button, which a terminal with a fixed `cwd` does not have.
The header keeps its `exited N`, since that is what shows while the panel is behind another.

**The same pty path as a session.**
`terminal.ts` has one spawn for both — the terminals map, the data and exit routing, the stop escalation and the quit sweep — with the claude-specific argument building and the plain-shell start as two callers of it.
A panel's shell is therefore stopped and swept by the same escalation as a session, asked with `SIGHUP` where a session is asked with `SIGTERM`, since an interactive bash, zsh or dash ignores `SIGTERM` (§ Stopping a session is a request), and nothing about it is a second implementation of a process the app runs.
It gets the `CLAUDE_UI_*` context in its environment and `COLORTERM=truecolor` as a session does, and NOT `CLAUDE_UI=1`: a `claude` started by hand in it must not report as one of the app's sessions.

**One xterm, one router.**
The renderer's `terminal.ts` builds every xterm in the window (the font tokens, the neutral foreground, the canvas fallback, clickable links) and routes every terminal's output and exit to whichever sink bound its id, a tab or a panel.
The tab's claude-specific key handling — Ctrl+Enter and Shift+Enter as newline, Ctrl+Z refused, Ctrl+C twice to close — stays with the tab.
A panel fits its xterm from a `ResizeObserver` on its own box rather than at mount, because it is mounted before the tree has placed it and the box measures nothing yet: the hidden-pane trap, in its "not yet placed" form.
The same observer covers every later reveal — a switch on the rail, an unfold, a divider reopening a squeezed node — since each gives the box a size again.

### Types from the config folder

A folder under `panel-types/` is a panel type of the person's own: a `panel.json` manifest and the script it runs.
The folder is `panel-types/` rather than `panels/` since each folder in it defines a TYPE, which the layout then uses for any number of panels, each with an id of its own; it was `types/` until 2026-10-14, renamed before any release read it, since `types/` beside `layouts/` and `scripts/` said too little.
It exists so a panel can be shared without being part of the app — the first one is a review queue fed by a task in another repo — and every choice below follows from that.
The contract itself, field by field, is `docs/panel-types.md`; this section is why it is shaped as it is.

**One list of fields per object, and the document is held to it.**
Each checker names the fields it reads in one list (`MANIFEST_FIELDS` and `OPTION_FIELDS` in `types/folder.ts`, `LIST_FIELDS` in `types/listdoc.ts`) and reads a field only through that list (`panels/fields.ts`), so a field it reads that the list lacks is a type error.
A test reads the document's tables and its lists of kinds and tones against the same lists, checks its marked examples with the checkers themselves, and holds its table of variables to what the runner sets: a field added on either side alone fails, the way the README's icon list is held to the icon set.

**The folder's name is the type's name**, so the two cannot disagree, and a folder is shared by copying it.
A folder named like a built-in type, or with a name that cannot be a type's, is not read, and a note under the whole layout says so, since no single entry is where it went wrong.
Main reads the manifests in the same pass as the layout file and hands them over raw, as it does the layout, so the renderer resolves the layout knowing every type at once and never shows an entry as a type nobody has for the moment between two reads.

**The kind decides the rest.**
A manifest names what kind of panel it is, and the kind brings its own options and behaviour; `list` is the one kind so far.
So `cwd`, `interval` and `watch` are the list kind's own, not something every panel takes: a shell has nothing to re-run, so the `terminal` type takes `cwd` alone, while the `command` type takes all three, as the same declarations.
A manifest is checked like the layout file — every mistake named, each prefixed with its file — and a type whose manifest is wrong is still a type, so every entry of it says what is wrong where the panel would be.
A field the manifest does not know is a note, not a mistake, and the same holds for the list a script prints: both are a contract a shared type is written against, with a `version`, so a field a later version added is ignored here and only a version bump is a break.
An edit to a manifest mounts that type's panels afresh: the type carries a revision, and the mount signature includes it beside the entry's options.

**The script describes and the app acts.**
A list script only prints; opening a row's link is the app's, through the same route every link leaves by, which takes http and https only.
That is the decision the whole shape rests on (2026-09-29): a JavaScript module loaded into the window would hold the bridge to every session, and a sandboxed page would need a message API of its own for the same result, while a script that prints can do nothing beyond running unless the person presses something.
It is also why nothing a script prints is ever markup: every row is built as text.

**Stdout alone is the list.**
A list run asks the runner to keep stderr apart: the script's stdout and stderr go to two pipes of their own, and the login shell's own output is discarded, so nothing an rc file prints can land in front of the document (measured against the real shell).
The `command` type still merges the two, in arrival order, since it shows what was printed.
Stderr's end is kept as the reason a failure gives: mise, for one, writes the task line there on every run.

**When it runs.**
On first being shown, on Refresh, on a context change while shown, as a `command` panel does, and on its interval, all through the same piece (`PanelRuns`, § The `command` type); the interval also runs while the panel is hidden or folded: the count on its rail icon is the point of a queue, and a count that stops while you are not looking says something false.
The first run of a panel with an interval is when the tree goes live, shown or not.
A run may say when it runs next through its control file, as a `command` panel's may (§ The `command` type); what the file gets wrong sits on the note line beside the type's notes and the list's own.
`watch: git` runs it again when its working tree changes, as it does a `command` panel (§ The `command` type).
The interval is ten seconds to a day: at least ten seconds, so a typo cannot start a script every second, and at most a day, which also keeps every wait well inside what a timer holds — past 2^31 − 1 ms (about 25 days) a browser's `setTimeout` wraps the delay to a signed 32-bit value, which up to about 49 days turns negative and fires at once, and beyond fires after some shorter, wrong delay, so a longer interval ran at the wrong time, mostly at once, every time.

**Never an empty list for a broken run.**
A run that fails, or prints something that is not a list, says so.
With a good list already there, the list stays under a line saying when the run failed and why, and that list's count stays beside it; without one the panel says it is unavailable, quoting stderr's last lines.
An empty queue and a broken one otherwise look the same, and one of them is a lie; blanking the list on every failure was the other way, and a bad minute on the network would blank it every time.
Before the first run has ended it says it is waiting, which is neither state.

**What it looks like is the app's.**
That is the default rather than a limit: a type is to be able to overrule it in a later version, and until then it chooses from the words the contract offers, such as a row's `tone`.
A row is the card a session row is, and a section heading the sidebar's group bar, built by the same builders (`card.ts`) and drawn by the same rules rather than restyled; a row's tone is the status colours on its leading edge, where a session row keeps its accent bar for "open in a tab".
A row's first line can carry a lead before its text and a trail after it, which the text gives way to; a lead is coloured by a tone of its own, from the same words and the same one map of tone to colour (`list.css`) as the row's edge, so a mark on a row never grows a palette of its own, and it never takes its row's tone, which would put a coloured edge on every row whose mark is coloured.
A row can hold rows (`children`), drawn after it a step further in, as siblings in its section rather than inside it, so a row stays the same element by its key wherever it sits, and a run that changes only its level, leaving its place among the section's rows, does not lose a press on it; it folds them from a chevron, or from a press anywhere on it when it has no link, and its folds are kept by key, in memory, while the panel stays mounted, as a section's are by title.
A section's count counts the rows that hold none, since a row holding rows only groups them.
A list can name `views`, the ways its script prints it, and with two or more the panel's header draws a switch between them beside Refresh: the first header control besides the one button that a type asks the tree to draw (`PanelHost.setViews`), as it draws the count, so a type that is not bare still builds no header chrome of its own.
A pick is the panel's as a group's picked panel is the group's: a layout entry's `view` is what it shows without one, read as the layout says it now rather than as it was when the panel mounted, since an edit of `view` alone does not mount it afresh; the app's file beside the layout keeps a pick only where it differs from that, or from the first view when the entry names none; the script is given the view on show as `CLAUDE_UI_VIEW` and a pick runs it again.
An entry naming a view its list does not offer is said in the group's note line, which only the list's views can tell, so the layout's own check looks at the shape alone.
The switch marks what is on show as a rail marks its panel, filled at rest, takes no pointer or hover on it since a press there does nothing, and is drawn again only when what it says changes, so a press on it survives a run offering the same views.
The count on a rail icon sits inside the button, under the icon on a vertical rail and beside it on a horizontal one: a corner badge was tried first, and at 3x even "9+" covered the whole icon on a 24px button, while the rail clips anything past its 28px.
The icon's tooltip and label say the count whole.

**A row can ask for a session, and only ask.**
A `session` action is a button on the row; pressing it hands the app a request (the item, the prompt, the name, the folder the panel last ran in), and the app opens its own dialog on it: the project, the group, the name and the first prompt, all changeable, and nothing starts before Start.
That dialog is the trust line for a shared type: a prompt runs with the person's permissions, so what a panel from anyone asks claude to do is always read first.
The projects offered are the switcher's, in its order and without those whose folder is gone; the one the panel's folder is in comes first, found as the deepest project that folder sits under (`projectFor`), and the folder itself is offered when it is in no project yet.
The group comes first as the one last picked from that panel in that project, while it still exists; making one is left to the session list, since the app never makes a group nobody asked for.
Start goes down the same path as any new session (`openNewSession`), with the name as `--name` and the prompt as claude's positional first prompt — placed LAST, after `--` and after the user's own flags, since a flag taking several values swallows a prompt after it and a prompt starting with `-` reads as a flag (both measured against claude before this was built).

**A row leads back to its sessions.**
The row asks its host for the sessions its item started that the app still has, latest first, and draws the latest's status dot with the session list's own classes, a count beside it when there are several.
A press goes to the session the way a jump from the live strip does — its project, its tab, its row — since the session is often in another project than the one on screen; with several, the app's menu offers them, each led by its own dot as the mark draws it, since a menu item that is a session takes a session's dot rather than a roll-up's.
The marks are repainted IN PLACE whenever the renderer repaints sessions itself (the switcher's roll-ups, the tab bar, the list), batched to once a task, so a status event never rebuilds the list under the pointer.
A link whose session the app no longer has is simply not drawn, whether or not main has forgotten it yet.
A second Review on such a row opens the dialog on CONTINUING the latest session, since that session holds what the first look found: stopped, it is resumed with the prompt as its first (`--resume <id> -- <prompt>`, checked against claude in print mode before this was built); running, it is brought into view and the prompt is not sent, which the dialog says before anything happens, because typing into a live session could land mid-turn or on a question and is never the app's to do.

**Which session a row started is the panel's data, kept by the app.**
One file per entry, `panel-data/<entry id>.json` in the app's data directory, with the sessions its rows started (by session id: the item's key, its text, its link, when) and the group last picked per project.
Not in `meta.json`, so a panel's data cannot damage the app's, and not in the config folder, which is what gets shared while a session id means something only on this machine.
The app writes it, never the script, which never learns a session id: the id is minted before the tab exists and the link written first, so the row can lead back to the session from the start.
A file that does not parse, or is of another version, is kept beside itself rather than overwritten, and an entry that is not sound is dropped and logged.
A file's reads and writes go one at a time, the window's reads among them: the window is told of a write once it lands, and a read that overlapped the write could answer with the file as it was before.
A link to a session that is gone is forgotten at the file's next write, whatever removed the session — the app's own delete, Claude Code's transcript retention (`cleanupPeriodDays`), or a hand — and at once when the app itself deletes it.
"Gone" is the app's own measure of a session existing: a transcript on disk, looked at rather than taken from the listing's cache, or a tab holding it, since a session that has sent nothing yet has no transcript and lives only in its tab.
The session being linked at that moment has neither yet, so it is kept.
Not by a link's age, which was the other way considered (2026-09-30): a session started long ago may have been resumed yesterday, and a retention period counts from something the link does not know.
A check that fails forgets nothing.

### Panel state

Where the tree was left lives in the app's file beside the layout, `layouts/default.local.json`, and never in the layout file itself: the sizes dragged to, the folds, the panel picked in each group and the view picked in each panel, per node or entry id, in the layout's own field names (`{ "nodes": { "drawer": { "size": 0.25, "folded": true } } }`), each winning over the field of that name in your file.
It is the layout's half of the pair the settings make (see The config folder), for the same reasons, and every field in it is one your file can carry, so keeping one for good is moving it there.
It keys on the file's ids, so an edit that renames a node starts it fresh rather than handing it another node's state.
Only what differs from your file is kept: a fold back to what the file says, or a pick of the file's `active`, takes the app's away rather than copying it (`keptOver`), and a size you change in the file counts at once for a node you have not dragged.
A double-click on a divider that drags takes every size kept for that split's children away, which is the file's sizes back.
The window changes its own state at once and asks main to keep it (`setLayoutState`, `src/main/layoutstate.ts`), which checks every change by the rules the window reads the file by (`nodeStateProblem`, `withNodeChanges` in `src/shared/panels.ts`); an id the layout no longer has is dropped at the next change, since what was kept for it is only a size, a fold or a pick.
Main reads the file with the layout, in turn with the writes to it, and says whether its text is what the app itself last wrote: if it is, the window's own state is as new or newer and stands; if a person wrote it, the window takes it in.
A mistake in it is named under the node it is about, or under the window for the file as a whole; one that does not parse is toasted, the window keeps what it has, and nothing is written over it.
Before the config folder this state was kept in `meta.json` as `UiState.panelState`; the first read moves it, once, worked out by the window against the tree since only it knows which node is which (`stateFromPanelState`), and `moved` in `meta.json` records it so a reset does not bring it back.
A split's dragged px become pixels for a pixel child and shares of what they shared for the rest, which shows the same, and the sidebar's width from before it was a node goes the same way.

## The window's own chrome — built, and currently switched off

**The app uses the system's window frame today.**
What follows is a complete alternative that exists in the code behind a single flag, `OWN_CHROME` in `main.ts`, and is turned off.

It works, and it was turned off for one reason: dragging the window is visibly steppy.
The gesture is the app's own, so every move is a round trip to the compositor, and it cannot be made smooth — handing the drag back to the compositor is smooth, but brings a double-click-to-maximize that draws the window offset from where it hit-tests and cannot be suppressed.
That trade was not worth it in daily use.

Both paths are live rather than one being dead code: macOS has always run the system-chrome side of every branch below, because a frameless window there would have no traffic lights.
So this describes what turning the flag back on gives, and why each piece is hand-built rather than borrowed from the OS.

With it on, the window is frameless and the app draws its own title bar: a strip across the top carrying the app mark, the version, and the minimize / maximize / close buttons.
macOS is deliberately excluded and keeps its native frame — a Mac window without its traffic lights is one you cannot close, and the variant that would replace them (`titleBarStyle: 'hiddenInset'`, with the sidebar header inset beneath the lights) is not built while nobody can look at a Mac to judge it.
One flag decides all of it, so the two never disagree: the frame, the buttons, the drag and the resize handles all hang off it.

Everything the OS would have done for that window, the app does itself, and each piece exists because the compositor's own version is unusable here rather than as a matter of taste.

**Maximize is `setBounds`, never `maximize()`.**
The native call paints a frameless window offset from where it hit-tests, so its controls are drawn in one place and clickable in another.
The app therefore never enters the native maximized state and keeps the flag itself.
The rectangle to fill cannot simply be the display's work area, because nothing here publishes one that accounts for the Windows taskbar — so the app asks the window manager the only way it answers, by maximizing a window nobody sees and reading the result back.
That answer belongs to whichever display the window manager chose, so it is remembered per display and asked again when an unmeasured one turns up.

**Every edge and corner is a handle the app draws.**
Chromium leaves a 4px resize margin on three sides and none at the top, so the top edge could not be resized at all and the other three were a hard target; eight handles at 6px, and 12px at the corners, make them uniform.
They clamp to the same minimum size the window enforces, which is one constant rather than two.

**Dragging the window is the app's too, and it stutters.**
That is a chosen trade, not an oversight.
Handing the drag back to the compositor — a drag region — is smooth, but it brings a double-click-to-maximize that uses the native maximize above, and that cannot be suppressed or intercepted: the decision is made on the first mousedown, and every route around it either deadlocks the window or leaves it drawing offset.
So the choice is a drag that steps and lands correctly, or a maximized window whose buttons are not where they appear — and since neither is good, the flag is off and the system draws the frame instead.
The gesture itself is one helper shared by moving and by all eight resize handles: it measures in screen coordinates, because the window moves under the pointer; it reports the total offset from where it began rather than per-move deltas, which would each be measured against the previous move's result; it starts only after a few pixels of travel, so a plain click on the bar of a maximized window does not restore it; and it sends at most one change per animation frame.

Two smaller things follow from having no OS title bar.
The version and the "dev" marker live in the app's bar, because the window title was the only place they were shown.
And a window manager here wraps every window in a 32px invisible frame of its own, which offers a resize affordance it does not honour — nothing in the app can remove it.

## Reopening the way you left it

Two things are restored on launch, and each has one rule worth knowing.

The **window's** size and position are stored as the unmaximized rectangle plus a maximized flag, and are checked against the displays that exist at launch rather than replayed blind: the size is a preference and survives a monitor going away (clamped to the screen it opens on), while the position is dropped whole once it no longer lands somewhere reachable — including a window with only a sliver on screen, or one whose title bar sits above the top edge and could not be dragged back.
The geometry decision is a pure function, so those cases are tested rather than reproduced by hand.

The **sidebar's** view — search text, the filter toggles, the date filter, folded projects and groups, scroll offset — is one object written as a whole (its width belongs to the layout tree now; see Panel state), on a debounce, and only when a snapshot differs from the last one stored; renders happen constantly for reasons that have nothing to do with the view.
Rolling date presets are recomputed from the current moment, so "last 7 days" still means the last 7 days; only a custom range is restored literally.
The filter panel comes back exactly as it was left, an active filter included — closing it over a filter you meant to keep is a choice to reclaim the space, and the filter icon carries an accent whenever anything is on.
The toggle is a funnel rather than a magnifier, because a magnifier promises a search box, which clears when it closes.
Clearing on close was the fix first asked for, and it would have made closing the panel disagree with quitting the app, which restores the filter on purpose.
Closing the panel never hides the filter, though.
Closed over a filter that is on, the panel folds down to one row of chips, one per thing that is on — the search text, each pill, the date range — each with its own ×, and a press on the row opens the panel again; the count and Clear sit on the line below, where they also sit under the open panel.
With nothing on, closing hides it all.
The count and Clear used to sit inside the panel, and a list filtered behind a closed panel read as every session there was, with a dot on a 14px icon left to say otherwise; moving just the count out was tried first and was still not enough, because a count says that something is on and not what.
The count's total is the set the matches were taken from: the same project scope and the same view before the other filters, so the count only ever compares a set with part of itself.
The archived pill picks that set rather than narrowing it, since the archived view holds only archived sessions and the normal view none, so in the archived view the total is the archived sessions and the count says "archived"; in the normal view it is the number the switcher shows.
One rule, `inView` in `logic.ts`, decides which set a session is in for the list, the switcher's counts and the total alike.

Folds come in two states, and they are deliberately separate.
Filtering opens the whole tree so a match inside a folded section is never hidden, and folding from there is a way through the results — shut a project you have already been through — rather than a statement about how the sidebar should look.
So those folds apply only while a filter is on and are dropped the moment one stops, by any route: Clear, the last character of a search, a date preset going back to Any.
Both states are stored, because the filter itself is restored, and coming back to the same results without the same view is the thing remembering the view is meant to prevent.

A **group** is a user-made sub-section inside one project.
Membership is one group per session, so it is stored as a session-id-to-group-id map — a session cannot be in two groups by construction.
Groups carry their own display order, and deleting one only unfiles its members; the sessions are untouched.
A group is made in one of two places, through one function (`promptNewGroup`): a row's "New group…" makes it around that session in the same write, so it is never briefly empty, and the project kebab's makes it empty.
Either way the list then jumps to it, because a new group lands at the top of its project, which can be far from the row or heading it was made from.
An empty group keeps its heading, which is how a new one is seen, except under a filter, which drops groups with nothing matching; a group made empty then is announced in a toast instead, since there is nothing on screen to jump to.

The nested shape (projects, their groups in order, then the sessions in no group, with pins floated inside whichever section they land in) is computed by a pure function in the renderer's `logic.ts`, so the ordering rules are unit-tested without a DOM.
A session started from a group's "+" is filed by the ordinary membership write, before its tab is built, so its row's first paint is already inside the group — there is no second, provisional membership anywhere, because the session has its real id from the start.

## UI conventions

Vocabulary, in code and in the UI: a **folder** is a literal directory path; a **project** is the grouping a session belongs to, keyed by its repo root, which merges a repo's worktrees and subdirectories into one entry; a **group** is a user-made sub-section inside a project.
A **panel group** is the layout's node of panels and unrelated to either, so the layout always says "panel group" in words meant for people.
The three are not interchangeable — one project spans several folders, which is why the switcher, the session list and the tab bar all say "project".

**The project scope holds everywhere.**
Selecting a project in the switcher is a statement about what you are looking at, so every surface honours it — the list, the tab bar, the placeholder's wording, and the archived view, which used to be exempt and no longer is.
Switch to All to search or browse across projects; that is what All is for.

**The empty terminal pane names the next action**, and it has four to choose from: no sessions at all, sessions but no tabs in this project, tabs but none selected, and a selected tab that isn't running.
One sentence cannot cover them — it ends up telling someone with no tabs to pick a tab.
Note it counts the tabs actually on screen (`visibleTabs()`, the same helper the bar renders from), not every open tab.

Any control that opens a menu or popover keeps its active look (the same look it shows on hover) for as long as the menu is open, including when the pointer moves off it.
The shared `openMenu` helper stamps `.menu-open` on the trigger while its menu is up, and an icon button takes its open look from the same rule as its hover (`.icon-btn…:is(:hover, .menu-open)` in `base.css`, one for each kind), so the kebabs, the group jump, the carets and a list row's session mark need nothing of their own.
A trigger that is not an `.icon-btn`, such as the sibling badge, or that sets a hover of its own, such as the project heading's split button, names `.menu-open` beside its `:hover` in that rule.
The open rules used to be written per trigger, five of them in step by hand, and the one trigger nobody remembered, a list row's session mark, showed nothing at all while its menu was up.
A row holding the trigger keeps its own hover look too, the card by `:has(.menu-open)` beside its `:hover` in `card.css`, the live strip's row by the same in the menu row's rule (`menu-row.css`), and a tab by the same in `tab-bar.css`.

Every menu/popover also reads as attached to its trigger: `openMenu`/`openSubmenu` add an `attach-top`/`attach-bottom`/`attach-right`/`attach-left` class and set `--notch-x`/`--notch-y`, which position a small notch on the menu's edge pointing at the trigger's center.
Anything new that floats near an anchor should go through those helpers so it gets the notch (and the active-state stamping) for free rather than reinventing positioning.

**One appearance, one rule.**
Anything drawn on more than one surface is a single class, never parallel rules kept in step by hand.
Parallel rules always drift, and they drift silently: the session mark and the strip mark were the same dot in two classes, and they diverged twice — first to two different sizes, worst on the busy arc, where 7px and 9px read as two different marks rather than one state; then to a hollow ring in the list and a 9px hole in the strip for a session that had not reported yet.
They are now one `.nudge`, with `.nudge.clickable` for the single surface where it is a control rather than a report.
The practical test: **a comment saying "match X exactly", or "same as Y", is a bug report against the stylesheet.**
It means the relationship is being maintained by whoever remembers it.
Extract the shared rule and let the difference be a modifier.
When a variant genuinely differs — a group heading is deliberately lighter than a project heading — that is a modifier on the shared base, not a second copy of it.

**A surface drawn again while it is used keeps its elements.**
A click is a press and a release on the same element, so a surface that takes the pressed element away between the two produces no click at all, and one that takes out the focused element drops the focus to the page.
The surfaces that keep their elements are drawn again on events nobody times — the session list when a transcript is written or a model switched, the live strip and the project switcher whenever a session's status changes, the tab bar whenever one of its tabs' sessions' does, a list panel on each run that prints a list and its rows' session marks whenever one of their sessions changes — so that press is an everyday one rather than a race.
So a surface keeps its elements by key and leaves in place what already is, through one helper, `keyed.ts`: `Keyed` holds the elements, built the first time a render draws a key and swept once one no longer does, and `placeChildren` puts them in order, keeping the longest run already in order where it is, so only what really moved is taken out.
Keeping them is not enough on its own: in Chromium, `appendChild`, `insertBefore` and `replaceChildren` take out even an element already where it belongs, which is how the session list, which had always kept its rows, still lost both.
The same goes for an icon inside a kept element: setting its markup again replaces the icon's own element, which sits over the middle of an icon button where a press lands, so an icon a render sets is set through `setMarkup`, which leaves the same markup alone.
A kept element outlives what it was built for, so its handlers look up what they act on by its key when they run, as a session row's read `currentByKey`, never what was current when it was built.
A library bound to a kept element lives as long as the element, and `Keyed`'s `forget` lets it go when the element is swept, as the tab bar's rows destroy their Sortable.
While such a library moves the elements itself, the surface does not draw: during a tab drag, Sortable moves the dragged tab and puts its copy of it in the row, so the tab bar holds a draw asked for meanwhile and makes it once the tab drops, rather than undoing the drag under the pointer.

**A module's stylesheet sits beside it, and the module imports it.**
esbuild bundles every stylesheet a module imports into one `renderer.css`, in import order, each file once, so `index.html` links only that: `xterm.css` and `air-datepicker.css` are imports of the modules that use them too.
A rule sits beside the one module that draws it; a rule several modules draw sits in a stylesheet of its own beside what owns it — the menu row in `menu-row.css`, the surface and notch every menu and popover floats on in `popover.css`, a dialog's or the pane's decisive button (`.primary`, `.danger`) in `decisive-button.css`, the filter pill in `pill.css`, the card and the section heading in `card.css` — or in `base.css` when nothing does (the tokens, the reset, `.icon-btn`, `.pair-end`, `.nudge`, the empty pane's sentence), and is never copied into each.
A stylesheet takes its place in the bundle where it is first imported, so `renderer.ts` imports `base.css` and the services first, ahead of every panel, and a rule that has to beat another of equal specificity sits after it in the same file.
Moving a rule between files can change which of two such rules wins without anything in the CSS's own diff showing it, so a move is checked with the style capture (§ The window's checks).
Moving an import can do the same, and the capture runs only when asked, so the order the stylesheets come in is pinned by a unit test (`test/unit/renderer/renderer.test.ts`): an import that moves a stylesheet fails it until the capture has been run before and after and the list updated.

**The tab bar's names are jumps into the list.**
A project's name scrolls the session list to that project and a group's to that group, and each flashes the heading it lands on: two labels at two levels doing the same thing, drawn from one shape and one hover rule.
The group's is the function behind the heading's jump menu (`revealGroup`), and the project's (`revealProject`) flashes through the same `flash()`.
The flash has no end keyframe, so it fades into whatever the element already has — a project heading's `--bg`, a group heading's `--surface`, an open row's accent bar.
It used to end on `--surface`, which is right only for a group heading, and on anything else it finished by snapping to the element's own colour; that went unnoticed until a project heading was flashed.

**A setting is named for what it turns on.**
Its key and its label say what happens when it is on, never what stops: a key such as `resumeSessions`, not `disableResume`, and never a `no…`, `disable…` or `hide…`.
So on always reads as yes, and nobody has to undo a negative to know what a box does.
Something the app does unless you say otherwise is therefore a setting that defaults to on, not an opt-out named for turning it off.
A setting with more than two choices names each for what it does: `runningSessionsAtLaunch` is `start`, `pause` or `leave`, and none of them is a `no…`.
It is one setting rather than two dependent boxes, which would allow a combination that means nothing.

### Sizes and shapes

Sizes come from a small set of decisions, not per-component choices.
Reach for the existing tier before inventing a value; if something genuinely needs its own, say why in a comment next to it.

**Icons** are inline SVG on a 16-unit viewBox, never font glyphs — a glyph resolves through system font fallback, which is how `⑂` once rendered from a monospace face beside its neighbours.
Ink is centred on (8,8) so flex centring needs no nudge, and stroke width is expressed as the *rendered* px weight (1.3px everywhere) converted to viewBox units per size, so a 9px mark and a 15px one look equally heavy.

**Clickable icons** are 14px, in one of three boxes: **standard** 24×20 (`padding: 2px 4px`) for sidebar, row and toast controls; **compact** 22×16 (`0 3px`) where density matters, i.e. the tab bar and a panel's header, whose height is fixed at 28px so a panel with a button and one without sit on the same bar; **large** 32×26 (`5px 8px`) for the header actions.
Each carries a 1px transparent border so the hover/active outline can't resize the box.
Documented exceptions: the note mark (inline inside a 12px text line) and the 9px nudge.

**Composite controls carry a resting border**, single icon controls don't.
The split buttons on the project and group headings are two halves acting as one button, so they need to look like one object before you touch them; outlining them only on hover makes the pair read as two loose icons that suddenly acquire a box.
A single icon needs no such help, and bordering each would put two more boxes on every row and heading.

**A session row's trailing controls sit 4px apart** — its pin and kebab, or its unarchive and delete in the archived view — so the pins line up down the list, not just the kebabs.
Tight rather than roomy because every pixel there is width the session title loses; the controls' own padding keeps their ink well clear.
The row's gap is 8, so one rule, `.pair-end` in `base.css`, works the offset out from the row's own `--row-gap`.
A heading's kebab sits 8px after its new-session button instead, since that button wears a border and the kebab's narrow dots crowded it at 4px, so on a group heading the split button's right edge sits 4px left of the pins below it, where it lined up with them (`headings.css`).
On a tab and on a live strip row the kebab sits right against the tab's button, the two one pair at the row's end (`.abuts`, from the row's `--row-gap` too).

**Hover** is one rule for each kind of icon control.
A borderless one — every icon button but a framed one: a kebab, the pin, a close or a stop, a row's unarchive and delete, the group jump, a rail's icons — turns its glyph `--accent` and nothing else, so one with a resting fill, such as the rail's panel on show, keeps it.
It used to fill and outline as well, which needs a box around the glyph; once a kebab's box hugged its dots, that box ran into the title and the button beside it, and without it controls can sit as close as their marks allow.
Accent rather than `--text`, which was tried first: `--text` is the same greyish blue as the resting `--muted`, only lighter, where accent is a saturated blue; the accent here is the same "you can press this" as a framed button's accent outline, not the live-session accent of a row's bar or a tab's edge.
The rail's panel on show in a group that cannot fold does nothing when pressed, so it keeps `--text` under the pointer.
A framed one, with a resting border — the header actions (`.large`), the split buttons' halves (`.composite`) and the divider's fold chevron (`.framed`) — fills `--active` with an accent border and a `--text` glyph, its border already saying where it is.
It uses `--active` rather than `--surface-hover` because a hovered session row is already `--surface-hover`, so a button filling to the same colour inside it would show no change; the project heading's `+`, on a filled bar, keeps a fill of its own (`headings.css`).
The app-wide `button:hover` fill and accent border leave icon buttons alone, which take only these, and both rules carry four classes' weight (`.icon-btn:where(…):not(:disabled):not(.unavailable):is(:hover, .menu-open)`), so a surface's own hover rule of the same weight after them can still win.

**A dialog's decisive button is filled**, in one of two colours of the same shape: `.primary` confirms (accent fill, dark text — the accent is a light blue, so white on it barely separates) and `.danger` destroys (red fill, white text).
Filled rather than outlined because `button:hover` sets an accent *border* app-wide, so a resting accent border is indistinguishable from an ordinary button being hovered — which is how the old accent-outlined Save read, and why it was replaced.
That same app-wide rule is why the hover state has to set the border itself, and it sets it to the fill: background and border are one colour, so the brightness step darkens the whole button and its outline never appears to move.
Each colour is named once, as a `--fill` custom property, which is what keeps that true — an earlier version reached for `currentColor` instead, i.e. the *text* colour, and hovered to a dark border on the blue button (it read as shrinking) and a white ring on the red one.

**Rows** come in three shapes: a **list row** (`.card`, a session's or a list panel's, built by `listCard`) is a card in the list body — `7px 14px`, surface radius, two lines and its own controls; a **menu row** (switcher entry, kebab-menu item, live-strip session) is `6px 9px`, control radius, one class and one hover for all three (`.menu-row`), which each of them carries and whose stylesheet each of their modules imports; a **compact list row** (a list panel whose list says `compact`) is the list row without its card — `3px 8px` with the heading's 14px on the right, control radius, no fill and no gap, one line of text — for a list scanned many rows at a time, such as changed files.
The compact row is a shape of its own on purpose, though it resembles the menu row: a menu row is a choice in a menu or a strip, and a compact row is an item in a list, so it keeps the list row's builder, hover and controls and only drops the card (decided 2026-10-13).
The menu row for what is on show, the switcher's entry (a project, or All) and the live strip's session whose tab is on show, wears one fill, `.menu-row.active`, and keeps it under the pointer.

**Radius and type are tokens** in `:root`.
Radius is per kind of thing rather than per component: `--radius-control` (anything you click), `--radius-surface` (rows, cards, panels, popovers, dialogs), `--radius-pill` (fully round, so it never needs re-tuning when its height changes); circles keep 50%.
Type is six steps — `--text-heading` 16, `--text-title` 14, `--text-body` 13, `--text-meta` 12, `--text-small` 11, `--text-badge` 10 — with no half-steps, since 0.5px is a smaller difference than one weight of the same size.

**Inactive** is `--muted` colour, never `opacity`: dimming fades a control's border and background too, which reads as disabled rather than unselected.
`opacity` is reserved for genuinely disabled controls.

**Form controls inherit their typography explicitly.**
The UA stylesheet gives every `button`, `input` and `textarea` `font: 400 13.333px Arial`, which is neither the interface font nor a size on the scale — so menus, dialog buttons, the search box and the filter pills all rendered in Arial until one rule set `font-family: inherit` and defaulted the size to `--text-body`.
Anything new that is a form control gets that for free; anything that needs a different step overrides with a token.

**A count wears a pill**, on both the project and the group heading.
It is not decoration: a bare number sits hard against whatever follows it, while a kebab's ink is 2.6px of dots floating in a 24px box, so the same gap in pixels reads as two very different distances.
The pill's own padding puts the digits about where a neighbouring icon's ink falls, which is what makes the spacing look even.
The group's pill fills with `--bg` because its heading bar is already `--surface`.

**Icon-only controls carry a tooltip and an `aria-label`.**
The filter pills are icon-only because words cost the panel an extra line at a 320px sidebar; the meaning has to survive that, so both attributes are mandatory rather than optional there.

### Traps worth knowing

**A sticky element pins its MARGIN box, not its border box.**
The group headings pin below the project heading; while the `h3` still carried its own `margin-top`, it parked exactly that far too low and left a band of scrolling rows visible between the two.
The space above a group lives on the `.group` section instead, so the heading has no margin to offset it.
The offset itself is the project heading's *measured* height, published as `--project-heading-height` — the same number the jump uses, so the two cannot drift apart, and neither goes stale when the type scale moves.


**`text-box: trim-both cap alphabetic` ends the box at the baseline**, so descenders paint outside it.
Combined with the `overflow: hidden` that any ellipsis needs, it silently clips every `g`, `p` and `y` — which is exactly what happened to the session meta line.
The fix is symmetric vertical padding: it gives the clip box room while keeping cap-top-to-baseline centred, so a mark beside the text stays aligned to its ink.
Measure the font's descent rather than guessing the value.

**A hidden pane measures as the default size, not as nothing.**
`FitAddon` sizes from the element's own box, and a `.term` is `display: none` until it is the active tab.
Fitting one before revealing it therefore yields xterm's 80×24 default rather than an error — and that default is what the PTY is told, so `claude` draws its entire TUI to 80 columns for the life of the session.
Reveal, then fit, then resize.
A session started out of sight, as a launch starts the ones that were running behind the tab on show, is revealed for the measurement alone and hidden again in the same task, which no paint comes between; with the terminal area itself hidden there is nothing to measure, and it is fitted when it is next selected.
Every conditionally-visible pane carries this hazard, split view included.
The whole terminal area is one now: it is hidden while another panel of its group is shown or its group is folded, so the tab fit refuses a terminal area with no size and leaves it to the `ResizeObserver` on it, which fires once the area has a size again.

**xterm's layers carry z-indexes of their own, up to 10.**
A `.term` makes no stacking context by default, so those layers competed with the history lying over the terminal area, painted over it and took its clicks.
Each `.term` is `isolation: isolate` for that reason: nothing inside a terminal can rise above its siblings, whatever number it carries.

**Under WSLg a held mouse button moves as a different pointer.**
The press arrives as the mouse, pointer 1, but the moves while the button is down arrive as a pen, pointer 2, and the release as the mouse again (seen in the app's log).
So a drag that captures the pressed pointer, or checks each move's `pointerId` against the press, sees no moves at all, and every headless check passes, since synthesized input keeps one pointer.
The history bar follows every move of a held pointer on the window instead, and ends on any release or on a move with no button down.

**Specificity quietly opts controls out of shared hover rules.**
`button:hover` is 0,1,1, so a resting rule like `.project h2 .project-kebab` (0,2,2) or `#toast-close` (1,0,0) beats it and never takes the accent border, while `.session-kebab` (0,1,0) does.
This produced three separate "why does only this one look different" bugs.
When a shared appearance matters, give the shared rule more weight than every resting rule it covers, and check with forced pseudo-states, as the style capture forces them, rather than by reading the cascade.

**A signature that lists its inputs is a guard nothing can check — so this one is checked by the compiler.**
The sidebar re-renders only when `structuralSignature` changes, which keeps a growing transcript from rebuilding the list.
Whether such a signature names *every* field the rows draw is a question about the whole render path, so it cannot be asserted cheaply, and getting it wrong does not churn — it **freezes**, leaving a field stale until something else happens to move.
It had been wrong: `model` was absent while the row printed it, so switching model mid-session showed the old one, and `worktree`/`repoRoot` were covered only by riding along with `cwd`.

The shape that fixes it is `AFFECTS_ROW`, a `Record<keyof SessionSummary, boolean>` naming every field with a yes or a no.
The annotation is the whole mechanism: adding a field to `SessionSummary` **fails to compile** until somebody says whether the list must redraw for it, which turns "did we remember?" into a question the build answers.
Only two are `false`, each with its reason written beside it — `lastActivity`, rewritten on every message of a running session, and `postCompactHeads`, which no row reads.
The general rule this stands for: **where stale is worse than an extra rebuild, make the exhaustive case the one the compiler enforces**, rather than trusting a list to be complete.

**Two surfaces can disagree about the same list, because only one of them re-rendered.**
The session list is assigned before that signature check decides whether to draw, so a transcript merely growing updates the data and skips the render.
The live strip is then rebuilt by the next status event, from the newer list, while the sidebar still shows the older one — which is why the strip appears to reorder itself on a dot changing.
Anything that reads the session list off a status event has the same hazard.

**A list you read while working needs to stay still more than it needs to be sorted well.**
The live strip has had three orders, and the first two both moved under the reader.
Sorting attention-first — sessions by urgency, projects by their most urgent session — reshuffled both levels on every status change.
Ordering it as the *session list* does was closer and still wrong, because the sidebar's own within-project order is **recency**, and most rows in this strip are running sessions: those timestamps are all moving, so two rows swap whenever the lower one writes a message.

It orders by **tab order** now, which is the only order available here that nothing on disk can touch — it changes when you open, close, drag or regroup a tab, and a drag persists.
Projects keep the explicit project order, which is also something you set by dragging, so both levels are yours.
"Tab order" is not the tabs array, though: the bar draws a project's ungrouped tabs first and then one row per group in registry order, so the strip shares that clustering (`orderAsTabs`) rather than reading the array directly.
Both call it identically, which is what keeps them from drifting.

**All three surfaces put projects in the same order**, the one you set.
The tab bar used to order them by whichever project it met a tab for first — emergent rather than chosen, and it moved on its own: closing a project's last tab and opening another sent that project to the end.
Pins are deliberately not floated here, unlike the sidebar: a pin says where a session belongs in the LIST, the tab bar has never honoured it, and floating one would be a second thing able to move a row you were reading.
The sessions still come from the session list, so a row shows what the sidebar shows; only the order is the tab bar's.
