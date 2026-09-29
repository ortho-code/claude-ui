# Architecture

## Environment

The app targets WSL 2 with WSLg.
The Electron app, the `claude` CLI it launches, and the `~/.claude` session store all live inside the same Linux distribution, so there is no Windows-to-WSL path translation.
WSLg shows the window.

Electron needs `--no-sandbox` under WSL; the `start` script passes it.

It runs on **X11 (Xwayland)**, the Electron default here. Do not switch it to Wayland: with `--ozone-platform=wayland` the window paints solid white, with or without
`app.disableHardwareAcceleration()`, while a bare Electron window with the same flags paints fine —
so it is something about this window, and it has not been chased down. `--ozone-platform-hint=auto` picks X11 anyway.

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
Tests are exempt, since a test may assert across the line — the launcher's flags against the reserved list, for one.

**The window never navigates.** Main refuses any navigation away from the app's own page and any new window (`will-navigate`, `setWindowOpenHandler`), because a page loaded there would get the preload's bridge, and the bridge runs commands.
Links leave through `shell:openExternal` instead, which accepts only http(s); the app itself never navigates, and `loadFile` is programmatic, which the event does not see.

## Reading sessions

`src/main/sessions.ts` walks `~/.claude/projects/*/*.jsonl`.
Each `.jsonl` is one session transcript with one JSON event per line.
For each file it streams the lines to pull the working directory and the first user message without loading the whole file, counts the events, and takes last activity from the file mtime.
The renderer groups the results by working directory.

## Build

Two TypeScript projects, because the two sides need different module systems:

- `tsconfig.main.json` — main and preload. `NodeNext` module and resolution, emitted as CommonJS (the package has no `"type": "module"`), so `require` and `__dirname` work.
- `tsconfig.renderer.json` — renderer. `ESNext` module with `bundler` resolution and the DOM libs.

TypeScript 7 removed the old `moduleResolution: "node"`, so both projects use the newer values above.
`src/shared` holds types and pure helpers, and each side compiles its own copy, so no module is shared at runtime.

**`typescript` in `package.json` is TypeScript 6, and `tsc` is TypeScript 7.** TypeScript 7 has no JavaScript API yet, and typescript-eslint, which lints with the compiler's own type information, cannot run without one.
So the `typescript` name holds `@typescript/typescript6`, the package Microsoft publishes for tools in this position, and the compiler the build runs is installed as `@typescript/native`, which is what provides the `tsc` command.
The alias goes once typescript-eslint's supported TypeScript range includes 7.

A third project, `tsconfig.test.json`, covers the test files, which are in neither build project.
The linter reads it, because a type-aware rule needs a project for every file it reads, and `npm test` type-checks it before running anything, because vitest strips a test's types without checking them.

`noUncheckedIndexedAccess` is on, so an index into an array or a record reads as possibly missing, and the code says why it is not: a check, or a `!` where the lines just before guarantee it.
The test project turns it off: a test that indexes past the end fails anyway, and the source files it pulls in are checked with it on by the build projects.

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
Only the **group** follows the tab across, because a group says where the work lives and clearing does not move the work. A pin and a note are about one conversation, and that conversation still has its row to hold them.

**The title on disk is left exactly as Claude Code writes it**, and that is a deliberate limit on the above.
Claude Code copies the cleared session's `custom-title` into the new transcript, in the same record a deliberate name is written to and with nothing to tell the two apart — and since a custom title is preferred over a generated one when a row is labelled, a named session goes on wearing the name it was handed.
The app could tell them apart, since it alone sees the end and the start arrive on one terminal, and an earlier version did exactly that.
It was removed: `claude --resume` lists that session under the copied name, and an app that showed a different one would put two names on one session. **Staying legible next to the CLI beats being tidier than it.**
In practice the case is narrow — 127 of 710 transcripts here carry a name at all, so clearing an unnamed session already produces a blank one with no help from us.

What is kept is the **pairing**, appended to the audit log: which session became which. Nothing reads it back. It is recorded because it is observable exactly once and nowhere else — neither transcript points at the other — and whether a cleared session should be shown as related to its predecessor is a question better answered later from what happened than guessed at now.

### Tab lifecycle: a tab can exist without a process

A tab owns at most one terminal, and `terminalId` is **nullable** — null means the tab is **cold**: it has its row in the bar, its title and its place in the layout, but no `claude` behind it.
Cold is a first-class state, not an error one.

A tab goes cold in two ways: it is **restored** that way at launch (the app starts nothing on startup — 20 restored tabs used to mean 20 processes at ~437 MB each), or the user **stops** the session with the tab's own button.
It leaves cold by being activated, which starts it immediately; there is no separate "start" affordance, because selecting a tab has always meant "work in this session".

Activating a tab can only ever **resume** it: the tab's own session is all it knows about.
The arguments that apply to a session's first start and to nothing afterwards — `--fork-session`, `--name`, `-w` — belong to the call that creates the tab, so that call selects the tab *without* starting it and starts it itself.

Two exits must stay distinguishable.
A **user stop** sets a `stopping` flag before the kill, and the exit handler checks it first: that tab is cooled and kept. **Any other exit** closes the tab, which is deliberate — it stops a finished session leaving an empty tab behind.

That separation is what the tab's button is built on: ending a session and removing a tab are different intents, so one press does not decide both. The first press stops a running session and leaves the tab cold, the second removes it, and a tab that is already cold goes in one. Both ends of a session's life disable the button rather than merely ignore it, for one reason: a tab acted on before its process has arrived, or while that process is still leaving, would leave the bar disagreeing with what is actually running. The mark follows the state, so which press you are on is visible: a stop square while there is a session to end, a cross once there is only a tab.
A third case sits in between: an exit within 1500ms of launch is treated as a failed start, and the tab is kept with the error visible in its terminal.

The cold state is visible in three places, all reading the same `terminalId === null`: the tab is unfilled rather than dimmed, the session row's left bar and the selected tab's top edge are `--muted` instead of accent, and the terminal pane explains that clicking the tab resumes it.
Those two marks answer the same question, so they answer it the same way — accent means a live session, nowhere else.

Where you were is remembered twice, in meta: `activeSession` (which tab to open on at launch) and `activeSessionByProject` (which to return to when you switch back to a project).
The in-memory `activatedSeq` still decides while a project has something running; the stored map only matters when nothing does, which after a restart is always.
Nothing is meant to be live after a restart, so the remembered tab is *selected* at launch but not started — a deliberately open question, since a tab marked active with no process behind it is arguable.

### Stopping a session is a signal, and a signal can be declined

Three things end a session — the tab's stop button, closing a tab, and the sweep at app quit — and they are **one function**, differing only in whether `claude` is given its own exit path first.
They used to be three, each sending a single signal and then forgetting the process: a bare `kill()`, which is `SIGHUP` and which a Node program is entitled to decline. The stop then reported success over a session that was still running.

Two things make it work now.
**The signal goes to the process GROUP**, not to the process the app spawned. That is the part that matters here: the app never talks to `claude` directly, only to a login shell that runs it, with `claude`'s MCP servers below that — so signalling the one process it knows about is the one thing guaranteed not to reach what it means to stop. It is sound because node-pty's child leads its own session, measured rather than assumed: `pid == pgid == sid` for every live session, so the pid doubles as the group id.
**And it escalates**: `SIGTERM`, then `SIGKILL` for anything still there after the grace period. Whether the first worked is read from the pty's own exit — the one place a session is recorded as over — rather than inferred from having sent something. A session that left politely is never killed afterwards, because by then its pid may belong to somebody else.

`before-quit` already delays the quit, which is what gives the escalation room to land, so quitting is not a special path.
Not implemented, and deliberately: their design also sweeps the group once more *after* the leader exits, for a grandchild that changed its own group. Nothing here has been observed needing it, and a `SIGKILL` aimed at a group id that no longer exists is the one version of this that could reach an innocent process.

### A session whose folder is gone

A session cannot run anywhere but its own directory, so when that directory is missing the app **refuses**, in two layers.

The launcher refuses the spawn outright. It used to substitute `$HOME` instead, silently: the session ran somewhere nobody chose, and then wrote its transcript under the home directory's project, so it moved in the sidebar too — the only sign being Claude Code asking for workspace trust on `~`.
That is the backstop, and it is deliberately below the UI, so nothing can reach a spawn by another route.

Above it, the session list carries two facts per session: whether its **own** directory exists and whether its **project's** does.
They are separate because a removed worktree leaves its repo perfectly usable, while a removed repo takes its worktrees with it — and the wording differs for the same reason. A missing worktree names the tree to recreate, since `git worktree add` at the same path brings the session back; a missing project has nothing smaller to point at.
Both are re-derived on every listing rather than cached beside the summary: a folder can be removed or put back without the transcript changing, and one stat per distinct path covers hundreds of sessions.

What that buys is a row that says so before you click it. A session whose folder is gone is dimmed and unclickable with the reason in its tooltip, its **Fork** item stays in the kebab but dimmed and inert, and the "+" on a project whose root is gone is unavailable with the same explanation.
Its tab, if it has one, is dimmed by the same rule with the same tooltip, and that is what tells it apart from a cold tab: cold is unfilled and resumes on a click, dimmed will not start at all.
The tab still selects on a click, since the pane is where the reason is said in full.
An action that cannot be taken is shown rather than removed: a menu that changes shape has to be re-read, and an item that vanishes looks like it was never there, where a dimmed one answers the question you opened the menu to ask.

**Unavailable is `aria-disabled`, never the `disabled` property**, and the reason is the tooltip: a natively disabled button emits no mouse events in Chromium, so a tooltip delegated from `document` never fires and the only thing explaining the refusal is invisible. `setUnavailable()` marks a control and carries the reason; the click handler refuses with `unavailable()`, which is the trade for a tooltip that works.
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
Group headings, the attention strip and the panels are left alone on purpose: the project heading above a group is sticky, so its mark is on screen the whole time; the strip lists running sessions, which a dead project cannot have; and a panel already refuses a folder that is not there, in words about its own folder.

Two cases no amount of gating can pre-empt — a folder that disappears while the app is running, and a tab you are already sitting on — which is why the refusal still has to explain itself when it happens.
A tab is kept, cold, rather than closed: the click meant "look at this", and the folder may come back.

(`claude -w` also `git worktree lock`s the tree it cuts, and that lock outlives the session, so a later `git worktree remove` refuses until the lock of a dead pid is cleared.)

## In-session history

Claude's fullscreen renderer (`"tui": "fullscreen"`) draws on the terminal's alternate screen and scrolls itself, so the terminal keeps no scrollback of the conversation, and claude publishes neither where it is scrolled nor how tall the conversation is.
So nothing here can follow claude's own scrolling, and marking lines in the terminal's buffer — xterm markers placed as each request is sent, the first design — has no line to hold on to.
The app draws a history of its own instead, from the session's transcript, which holds every request and reply, outlives every restart, and keeps what a compaction took out of claude's own view.
The code is in `src/main/transcript.ts` (reading) and `src/renderer/history/` (the view, the bar and the loupe).

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
Not a request: tool results, meta records (a skill's expanded body, a message from another session), compaction summaries, interruptions, and Claude Code's own tag-wrapped plumbing (a local command's output, a reminder, a task notification, `!` bash mode), whether it comes as a user record or queued while claude worked — the queued ones were missed at first, and drew 253 task notifications as requests.
The rule was taken from a scan of 312 transcripts, and the numbers below are from them.

**A slash command counts only once claude answers it.** `/review` and `/learn` are answered, `/model` and `/clear` are not, and nothing in the command line tells them apart — `/learn` usually has no arguments, `/model` usually has one; 265 were answered and 112 not.
So a command waits for an assistant record, across reads of a file claude is still writing, and is dropped if the user sends something else first.
Leaving slash commands out altogether was the first rule, and it left a session that was one `/review` doing all the work with an empty history.

**A transcript is a tree, and it keeps abandoned attempts.** Stopping claude and sending again, or editing and resending, leaves the first attempt in the file beside the second, both hanging off the same parent record.
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

**Claude Code writes records twice.** After a compaction it writes much of the conversation into the file a second time under the same uuids, with only bookkeeping changed (git branch, version, prompt id; the message itself in 3 of 6,490 copies, in 8 transcripts).
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
The dot is drawn in CSS rather than claude's `⏺` glyph, since the app draws no mark from a font.
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

Rather than parse terminal output to guess a session's state, the app drives status from Claude Code hooks.
On startup it writes a hook script and its own settings file to `~/.config/claude-ui/`, and passes that file to `claude --settings`, whose hooks merge with the user's own — so claude-ui never writes into `~/.claude/settings.json` (an earlier version did, and still strips those entries when it finds them).

Five events map straight to a status: `UserPromptSubmit` → busy, `PostToolUse` → busy, `Stop` → idle, `Notification` → waiting, `SessionEnd` → closed.
Two more are not that simple, and both cost a wrong guess to work out.

**Compaction is work, so it reads as work.** `PreCompact` → busy, and the END of a compaction is a `SessionStart` carrying `source=compact`, which the script rewrites to idle.
`PostCompact` looks like the obvious end signal and is not used: a probe never observed it firing and could not prove it ever does, while `SessionStart` was observed.
That follows from what the states mean here — **idle is "finished something, and your input is required to continue", not merely "not busy"** — so a session thinking about its own transcript is busy, and green when it comes back.

**A model switch is neither, so it gets its own file.** A transcript records which model *answered*, never which one was chosen, so `/model` leaves no trace in it until the next reply — and the row went on naming the old model in between.
`PostModelSwitch` is the only place that answer exists at the moment it becomes true; its payload carries `from_model`, `to_model` and `source`, and `to_model` is written to `<id>.model` beside the status rather than into it, because the two answer different questions about the same session.
The renderer prefers it over the transcript's and keeps it **in memory only**: every switch in a session this app runs lands there, so it can never be staler than the file, and after a restart the transcript's own last answer is the right source again.

**`SessionStart` is mostly identity, not state.** Its session id is what the terminal is running *now*, which is the only way to follow a `/clear` (below). For every source but `compact` the script writes an identity-only marker that the renderer applies to the tab and never shows as a dot, and it refuses to overwrite an existing status file — these files seed the dots at launch, and the event also fires mid-session, where a real status is worth keeping.
For the same reason that marker is dropped when the launch state is read back: identity is answered by the tabs being restored around it, and seeding it would hand the renderer a status no dot has wording for.

**`SessionEnd` ends the session it names, every time — including `clear` and `resume`.**
Those two leave the *process* running, which makes them look like exceptions, and one was written here on that basis and reverted the same day.
This app tracks **sessions, not processes**: `/clear` writes a last line to the old transcript and opens a new file under a new id, so the id the event carries really is finished, and declining to close it leaves a dead session showing a live dot for good.
The process's next session arrives separately, as the `SessionStart` above.

The general shape, for any hook added later: **ask what the event means for a SESSION before mapping it to a state.** An event named for a lifecycle is not necessarily about the lifecycle you are tracking.

The cleanup of hooks an older version injected into `~/.claude/settings.json` scans every event in that file rather than the ones this version registers, so an entry for an event since dropped is still found.
A hook also has about a second to answer before Claude Code moves on, so it must never wait on anything: answer, then finish detached.
The script is covered by tests that run it the way Claude Code does — argument, JSON on stdin, `CLAUDE_UI` set — because it is the one part of the app that executes outside it.

The hooks are scoped to claude-ui: it sets `CLAUDE_UI=1` on the terminals it spawns, and the hook script no-ops unless that variable is set, so sessions run in a plain terminal are left untouched.
When it does fire, the script writes `~/.config/claude-ui/status/<id>.json`.
The main process watches that directory and pushes updates to the renderer, which shows a dot per session: busy, idle, waiting, or hollow (`closed` and unknown states have no color).

## App-side metadata and session groups

Everything the app knows that Claude Code doesn't — pins, archived sessions, open tabs, per-project display names, custom groups, the window's geometry, the sidebar's view state, where the layout was left and the app's own preferences — lives in a `meta.json` under the app's own user-data directory.
Preferences are kept apart from view state, in `settings` rather than `ui`: one is what you chose, the other is where you left off, and neither should be able to reset the other.
The session store is never written to: `~/.claude` is read-only as far as this app is concerned.

Writes are serialized through one queue and land via a temp file renamed over the target, with the previous good copy kept as a backup, so a crash mid-write can't leave the file half-written.
Reads are tolerant by design: unknown or malformed entries are dropped rather than trusted, and older field names are still understood, so an older `meta.json` upgrades in place without a migration step.

## The log

An installed build is started from a launcher, so it has no stdout: the log is where what a launch did can be read afterwards, on somebody else's machine.
The main process writes it (`src/main/log.ts`), and the window's own lines reach it through the preload bridge, checked on arrival: a known level, an area that is one short lowercase word so no area can forge a line, text only, cut at 4,000 characters.

**One file per launch per date**, in `app.getPath('logs')` — `~/.config/claude-ui/logs` on Linux, `~/Library/Logs/Claude UI` on macOS — named by the local moment it started, `claude-ui-20260928143012.log`.
Each opens with a header: its own path, the version, how the app was installed, the OS, the Electron and Chromium versions and, on Linux, the display variables.
A run that crosses midnight starts a new file on its first write of the new date — a write rather than a timer, which cannot be trusted across sleep — and that file repeats the header and names the one it continues, so every file stands on its own.
One shared file per date was rejected: a crash in the morning and a clean launch in the afternoon would share it, and a file can only be kept whole.
The folder is read in `paths.ts` below the `userData` pin and nowhere else, because the call creates it as a side effect, and on Linux, made before the pin, it resolves under the product name and leaves a stray `~/.config/Claude UI/logs` behind.

**There is no size cap.** The date roll keeps a file readable and loses nothing within a run.
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

**Uncaught errors are observed, not handled.** The log listens on `uncaughtExceptionMonitor`, never `uncaughtException`: Electron shows its "A JavaScript error occurred in the main process" dialog only while it is the one listener for the latter, so a listener here would take that dialog away in silence.
The monitor also receives unhandled rejections, which Node raises as uncaught exceptions, and a test pins that the listener count does not change.
The window's uncaught errors arrive through `console-message` as `Uncaught …` lines — measured, not assumed — so forwarding its warnings and errors is its crash reporting too.

**What is written**: each terminal's start, with its pid (which the SIGKILL line names), its stop and its end; panel runs that fail; the layout file's state when it changes; a folder that cannot be watched, when the reason is anything but "not there"; which copy of `meta.json` the app went on with when it had to recover one; git missing or timing out; the GPU status whenever it changes; and which renderer the terminals draw with.
**What is not**: prompts, transcript text, session and worktree names, the value of a flag, a panel's command line or its output.
The one exception is a failed start's last five lines, which for a resume that dies at once can include some of the history it had just drawn.

## Panels

A layout file arranges the whole window: rows and columns of panel groups, with the sidebar and the terminal area as two of the panels.
Per-project and named layouts are the next steps of the same design, and the file's shape leaves room for them.

### The config folder

Everything a person may edit or share lives in ONE folder, `config/` under the app's data directory, and nothing else does: the layout file at `layouts/default.json`, the scripts it points at under `scripts/`, and panel types of the person's own under `types/`.
It sits apart from `meta.json` and the status files on purpose.
Those are machine state the app writes, which nobody should edit and nobody would want to hand a colleague; this folder is the opposite on every count, so "copy this folder" hands over exactly the customisation and none of the state.
`layouts/` is a directory rather than a single `layout.json` so that named and per-project layouts can be added beside the default instead of by moving it.

The app creates the folder, reads it and watches it, and in this version never writes into it.
That is what keeps an editor, id assignment, normalisation and an atomic-write path out of the slice, and it also settles the trust question for now: a command in a hand-edited file is the user's own, and a trust step arrives with the first thing that lets a command reach the file by another route — the app's own editor.
A type folder a colleague shared is the other route, and it was decided (2026-09-29) to add no trust step for it: it runs as you, the way a script in `scripts/` does, and what makes that acceptable is that a type can do nothing beyond running its script without being pressed (see Types from the config folder).
The settings dialog shows the folder's path with an Open button, which is the whole of the UI for finding it.
It opens the folder itself (`shell.openPath`) rather than showing it selected in its parent (`showItemInFolder`): a Linux file manager without FileManager1 support, which is what WSLg offers, opens the parent and selects nothing, which reads as the wrong folder.

Directories are watched one by one rather than the folder recursively (recursive watch is unreliable on Linux and WSL, as the session watcher found): the folder, `layouts/`, `scripts/`, `types/`, and each type's own folder.
An event on the folder itself re-opens the ones below it, because a directory deleted and recreated leaves its old watcher pointing at nothing, and an event on `types/` re-lists the type folders, so one added there is watched from then on.
`scripts/` is watched so that a script appearing, or gaining its executable bit, clears the panel's error without a restart; that an attribute change reaches a directory watch was measured rather than assumed.

### The layout file

The file is ONE TREE, and the app's own surfaces are nodes in it: `{ "version": 2, "root": … }`, where every node has an `id` and exactly one of `rows`, `columns` or `panels`.
A node with `rows` or `columns` is a split; a node with `panels` is a **panel group**, which shows one panel at a time.
"Panel group" is the layout's word, and a plain "group" stays the session list's (see UI conventions); the two are unrelated.
The first shape of the file, one panel beside the terminal, never shipped, so version 1 is refused with a notice rather than converted.

A panel is an ENTRY in a group, not a file of its own: `{ "id": "status", "type": "command", "options": { "command": "git status --short" } }`.
**The layout reads the layout, and a panel reads its own options.** `id`, `type`, `title`, `hidden` and `icon` are the layout's, and it checks them; `options` is the type's, handed over whole and read by nothing else (see A type owns its options).
The nesting is that rule made visible in the file rather than kept as a list of names the layout holds back: a field the layout gains later can never collide with a type's setting, and an unknown key is named by the side that owns it — the layout for the entry (`"tilte"`), the type inside `options` (`"comand"`).
Entries used to be flat, the shape of Claude Code's statusline and hooks, so that a line could be pasted from one file into another; in practice that saved one line, and it made every future layout field a name no type could use. Grafana's panels, the nearest thing to this file, nest theirs under `options` too, which is where the name comes from.
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
A file that does not parse keeps the last good layout up and toasts the file and the parser's position until a read succeeds.
The validator (`src/renderer/panels/layout.ts`) is pure and tested per rule, including every refusal, so a validator that accepts everything fails its tests.

**The default layout lives in code, never on disk**: the sidebar at 320px beside the terminal area.
It is what a missing file means, and what an unparsable one means before any good read, so there is always a way back to a window that works — a file could be moved, deleted or renamed, and the default cannot be.
It goes through the same validator as any file, and a test pins that it resolves without a word said.

### The app's own surfaces are panels

Two built-in types exist: `sessions`, the whole sidebar (switcher, actions, filter, list, attention strip), and `claude`, the terminal area (tab bar and terminals).
For now they are OPAQUE: each is the element the app has always built, moved into the group that places it and parked in a hidden holder if the layout lets go of it — never rebuilt and never disposed, so a layout change keeps every running session and its xterm exactly as they were.
Splitting the sidebar into panels of its own is later work, one surface at a time.

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

ONE UNIT FOR EVERYTHING: a share is a flex weight, and a dragged size is stored in px and used as that same weight, so a drag and the file's proportions mix without conversion, and a window resize redistributes by weight with no code at all.
A split's dragged sizes are honoured only while they name every one of its children, and dropped whole when its children change, so a file edit that adds or removes a child falls back to the file's sizes rather than keeping half of each.
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
Folding first stores every sibling's measured size, the folded group's own included, so it unfolds to the size it had and nothing else moves when it does.
Only panel groups fold; `collapsible` on rows or columns is named as not honoured yet.

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
A `command` panel does not run while hidden; a context change meanwhile is remembered as a difference, and it runs once when shown — and not at all if the context came back to where its last run was (`RunGate`, tested).
A `terminal` keeps its shell and refits from its own `ResizeObserver` once it has a size again.

At start-up the default layout is drawn before the first paint, the file is read before a single row is drawn — so the sidebar and terminal area are moved into the tree while they are still empty — and panels are shown only once the tabs are restored, so a panel's first run is in the restored tab's folder.

### A type owns its options

A panel type is a module under `src/renderer/panels/types/`, and it declares its options in one place: name, kind (`text` or `path`), for a `path` what it resolves against and what it must point at, and which groups of options are exactly-one-of.
The layout sees only what it needs to draw and place an entry: the default icon, a default title from the options where they give one, whether the type is bare, and whether it is a built-in the layout must place once.

**The type checks its own options**, with one checker every type shares (`panels/options.ts`), driven by that declaration: a key it does not know, a missing or doubled exactly-one-of, a value that is not a string or is empty, and what a path points at — the last asked of the main process, which has the filesystem.
It checks when it is mounted, so a panel behind another already wears `alert` on its rail; before every run or shell start, since a script can go missing between runs; and whenever the config folder changes, which is how a script gaining its executable bit clears without a restart.
It says what it found through its HOST, the tree's side of a conversation that already carried the busy mark, the run's last word and the rail dot: "cannot run, because …" is drawn with the same problem list the layout's own refusals use, with `alert` on the rail icon, and a note goes on the group's note line. `alert` is "will not start as its options stand"; the red dot is still "a run failed".
A built-in reports what it does not understand as notes, never as problems, because no file may produce a window without the sidebar or the terminal.

It was the other way round at first — main checked every `script` in the file when it read it, so one read named everything — and it moved for two reasons. A path relative to the selected project, which the `cwd` option needs, changes while the app runs, so no read of the file can answer it; and a layout that knows a type's option names is a layout every new option has to touch. The cost is that a missing file is named when the panel checks rather than in the same read as the file's shape: the same place on screen, a moment later.

The type also owns its panel's body and its run; the tree (`tree.ts`) draws only what is around it — the header, the rail icon and its dot, the dividers, and the problems a panel reports.

### The `command` type

It runs something and shows what it printed, and it takes its command in one of two ways, exactly one required.
`command` is a command line, run by a fresh copy of the user's shell as they typed it, so pipes and quoting are the shell's business.
`script` is a path to an executable, relative to the config folder, absolute, or under `~/`, passed to the shell as ONE argument with no parsing of the path, so a space in it is nothing.
The type kept the name `command` for both: a one-liner is not a script and a script is not a command line, and Claude Code's statusline and hooks say `"type": "command"` for either.

A script resolves against the config folder ONLY, never the selected project, deliberately: a project-first lookup would change which code runs, not where — a repo with a file at the same path would silently replace yours, and since a panel runs on show and on a project switch, selecting a freshly cloned repo would run its executable unasked. A project's own script is reachable, explicitly, as `"command": "./bin/status"`, which the shell resolves in the context directory.
The resolver is one function in main (`resolvePath` in `config.ts`) used by the panel's check and by the run, so the two cannot disagree about which file was meant.

The command runs in the panel's CONTEXT DIRECTORY — the active tab's cwd, else the selected project's repo root — so a worktree session's panel reports the worktree.
That is the one thing that differs between the two forms: a relative path INSIDE a command line is resolved by the shell against that directory, while a relative `script` resolves against the config folder, so the script travels with it.
The context reaches the command as environment variables only for now (`CLAUDE_UI_PROJECT_ROOT`, `CLAUDE_UI_CWD`, `CLAUDE_UI_SESSION_ID`, `CLAUDE_UI_CONFIG_ROOT`); JSON on stdin joins when a second type wants it.
With neither a tab nor a project the panel says "Pick a project to run this in." and runs nothing.
It runs when first shown, on Refresh, and when the context directory changes, which a tab switch, a project switch and stopping the tab you are on all do — but never while hidden (see A layout change keeps panels running).

### Where a panel runs: the `cwd` option

Both the `command` and the `terminal` type take a `cwd`, one declaration (`CWD_OPTION` in `options.ts`) and one rule (`placement` in `types/command.ts`, tested), because "where does this panel run" is one question with one answer on both.
Without it, the panel runs in the context directory. An absolute or `~/` value is FIXED: that folder whatever is selected, so it runs with no project at all. A relative value is under the context directory, so `"cwd": "packages/api"` follows the project into its subfolder — and a worktree session's panel into the worktree's copy.
The folder the run uses is the one main's check resolved, so the run goes exactly where the check looked, and `CLAUDE_UI_CWD` names it; the project and session variables are the selection at the moment of the run, empty when there is none.

A relative `cwd` resolves against the project and never falls back to the config folder, which was considered: the same file would then run in different places depending on which folders happen to exist, and a typo in one project would silently become a folder in the config directory.
(`script` is the opposite way round for the reason given under The `command` type: a `cwd` only moves where your command runs, while a project-first `script` would change which code runs.)

**A fixed `command` panel does not run again on a switch**; it runs on first show and on Refresh. It has nothing new to read, and re-running it on every tab click would print the same folder's output again — which is what keying it on the whole context, as before, would have done, since its variables change even when its folder does not.
The run is keyed on where it goes (`runKey`, tested): the whole context without a `cwd`, as it always was; nothing that changes for a fixed one; the folder it lands in for a relative one, so a tab switch within that folder does not re-run it.
A refresh on a timer, or a script that refreshes itself, is later work, and when it comes it is the answer to "when does a panel run" for every panel, not one for this option.

### How a command runs

**Through the same shell as a session.** `src/main/shell.ts` holds the one login-shell invocation both use, so `PATH` is identical: the rc files that put mise, direnv and the MCP servers' tools on a session's `PATH` run for a panel too.
The command is a positional parameter of a fixed script of the app's, never interpolated into it.

**Measured: an interactive login bash without a tty prints two lines of job-control noise on stderr before anything runs (`cannot set terminal process group`, `no job control in this shell`), and `logout` on exit if it is still the parent when the command ends.**
Both are handled by shape rather than by filtering text: the spawn discards the SHELL's stderr, the script's first act is `exec 2>&1` so the COMMAND's stderr joins the one pipe — which is also what puts the two streams in true arrival order — and the command is `exec`ed in the shell's place, so nothing is left to say `logout`.
Dropping `-i` was the alternative; mise resolves without it on the machine this was written on, but the rc-based setup would be skipped and a panel would no longer see the `PATH` a session sees.

**Non-interactive, spawn and read.** No pty: stdout and stderr in one pipe, output capped at 1 MB and the run at 30 seconds, after which the process is stopped and the panel says so.
A process that never exits by design — a dev server, a watcher — is not this panel type.
Plain text is asked for with `NO_COLOR=1` and `TERM=dumb`, and escape sequences are stripped on top for the tools that do not listen, with a sequence cut at a chunk boundary held back until the next chunk completes it.

**Stopping is the group.** The child is spawned `detached`, so its pid is a group id, and a stop is the same SIGTERM-then-SIGKILL escalation a session gets, shared from `shell.ts`, reading whether it worked from the child's own exit.
A re-run stops the run before it, removing the panel from the file stops it, and quitting sweeps every live run down the same path; hiding it does not.
The end of the OUTPUT (`close`) and the end of the PROCESS (`exit`) are read separately: something the command started can outlive it holding the pipe, and once the leader is gone nothing may be signalled, since its pid may already belong to somebody else.

**`CLAUDE_UI` is deliberately not set.** It is the marker the status hooks fire on, and a panel that happens to run `claude -p` must not report as a session.

**A run carries a token.** The renderer mints one per run and every event echoes it, so output still in flight from a run just replaced never lands in the new run's body.

### The `terminal` type

A plain shell in a panel: the interactive login shell a session runs `claude` in, with nothing to run, in a pty, shown in an xterm.
Its one option is `cwd` (see Where a panel runs).

**It stays put.** The shell starts where the panel is placed at the moment it first shows — the context directory, or its `cwd` — and stays there through tab and project switches.
A shell has state — the command you have running in it — so following the context the way the `command` panel does would kill that command on every switch, and one shell per directory kept alive and swapped like tabs is a lifecycle that belongs with groups and tabs, not here.
So the header names the folder the shell is in, the button is "Restart here", which kills the shell and starts one in the current context, and the one exception is a panel with no shell because there was nothing to run in, which starts as soon as a context appears.
The type declares that button's label itself, per entry, so the tree keeps one button and the type says what it does.
**A terminal with a fixed `cwd` has no button**: it would restart in the same place, so what is left of its purpose is bringing a dead shell back, and a key press does that (below). One whose folder is missing says so in its place, like any panel that cannot run, and looks again whenever it comes back into view and whenever the config folder changes — with no button, being looked at is how a folder that has appeared since gets picked up.

**A shell that exits comes back on a key press.** Its screen stays up with a dimmed line saying it exited and that any key starts a new shell, and the next key does, through the same start the button uses; the key is the ask, so it is not sent on to the new shell.
That is what VS Code's terminal does, and it was chosen over a button that appears only once the shell has gone, and over restarting on exit by itself, which would need a guard against a shell that dies at once — a broken rc file, say — starting again forever.
It exists so that getting a shell back never depends on the button, which a terminal with a fixed `cwd` does not have.
The header keeps its `exited N`, since that is what shows while the panel is behind another.

**The same pty path as a session.** `terminal.ts` has one spawn for both — the terminals map, the data and exit routing, the stop escalation and the quit sweep — with the claude-specific argument building and the plain-shell start as two callers of it.
A panel's shell is therefore stopped and swept exactly as a session is, and nothing about it is a second implementation of a process the app runs.
It gets the `CLAUDE_UI_*` context in its environment and `COLORTERM=truecolor` as a session does, and NOT `CLAUDE_UI=1`: a `claude` started by hand in it must not report as one of the app's sessions.

**One xterm, one router.** The renderer's `terminal.ts` builds every xterm in the window (the font tokens, the neutral foreground, the canvas fallback, clickable links) and routes every terminal's output and exit to whichever sink bound its id, a tab or a panel.
The tab's claude-specific key handling — Ctrl+Enter and Shift+Enter as newline, Ctrl+Z refused, Ctrl+C twice to close — stays with the tab.
A panel fits its xterm from a `ResizeObserver` on its own box rather than at mount, because it is mounted before the tree has placed it and the box measures nothing yet: the hidden-pane trap, in its "not yet placed" form.
The same observer covers every later reveal — a switch on the rail, an unfold, a divider reopening a squeezed node — since each gives the box a size again.

### Types from the config folder

A folder under `types/` is a panel type of the person's own: a `panel.json` manifest and the script it runs.
It exists so a panel can be shared without being part of the app — the first one is a review queue fed by a task in another repo — and every choice below follows from that.

**The folder's name is the type's name**, so the two cannot disagree, and a folder is shared by copying it.
A folder named like a built-in type, or with a name that cannot be a type's, is not read, and a note under the whole layout says so, since no single entry is where it went wrong.
Main reads the manifests in the same pass as the layout file and hands them over raw, as it does the layout, so the renderer resolves the layout knowing every type at once and never shows an entry as a type nobody has for the moment between two reads.

**The kind decides the rest.** A manifest names what kind of panel it is, and the kind brings its own options and behaviour; `list` is the one kind so far.
So `cwd` and `interval` are the list kind's own, not something every panel takes: a shell has nothing to re-run, so the `terminal` type takes neither, and the `command` type gains `interval` only when it needs one.
A manifest is checked like the layout file — every mistake named, each prefixed with its file — and a type whose manifest is wrong is still a type, so every entry of it says what is wrong where the panel would be.
A field the manifest does not know is a note, not a mistake, and the same holds for the list a script prints: both are a contract a shared type is written against, with a `version`, so a field a later version added is ignored here and only a version bump is a break.
An edit to a manifest mounts that type's panels afresh: the type carries a revision, and the mount signature includes it beside the entry's options.

**The script describes and the app acts.** A list script only prints; opening a row's link is the app's, through the same route every link leaves by, which takes http and https only.
That is the decision the whole shape rests on (2026-09-29): a JavaScript module loaded into the window would hold the bridge to every session, and a sandboxed page would need a message API of its own for the same result, while a script that prints can do nothing beyond running unless the person presses something.
It is also why nothing a script prints is ever markup: every row is built as text.

**Stdout alone is the list.** A list run asks the runner to keep stderr apart: the script's stdout and stderr go to two pipes of their own, and the login shell's own output is discarded, so nothing an rc file prints can land in front of the document (measured against the real shell).
The `command` type still merges the two, in arrival order, since it shows what was printed.
Stderr's end is kept as the reason a failure gives: mise, for one, writes the task line there on every run.

**When it runs.** On first being shown, on Refresh, on a context change while shown, as a `command` panel does, and on its interval, which also runs while the panel is hidden or folded: the count on its rail icon is the point of a queue, and a count that stops while you are not looking says something false.
The first run of a panel with an interval is when the tree goes live, shown or not.
The interval is at least ten seconds, so a typo cannot start a script every second.

**Never an empty list for a broken run.** A run that fails, or prints something that is not a list, says so.
With a good list already there, the list stays under a line saying when the run failed and why, and that list's count stays beside it; without one the panel says it is unavailable, quoting stderr's last lines.
An empty queue and a broken one otherwise look the same, and one of them is a lie; blanking the list on every failure was the other way, and a bad minute on the network would blank it every time.
Before the first run has ended it says it is waiting, which is neither state.

**What it looks like is the app's.** A row is a session-list card and a section heading the sidebar's group bar, shared through the same rules rather than restyled; a row's tone is the status colours on its leading edge, where a session row keeps its accent bar for "open in a tab".
The count on a rail icon sits inside the button, under the icon on a vertical rail and beside it on a horizontal one: a corner badge was tried first, and at 3x even "9+" covered the whole icon on a 24px button, while the rail clips anything past its 28px.
The icon's tooltip and label say the count whole.

### Panel state

Where the tree was left lives in `UiState.panelState`, per machine, and never in the layout file, which is what may be shared: the dragged sizes per split and child, the folded groups, and the panel picked in each group, all keyed by the file's ids.
So an edit that renames a node starts it fresh rather than handing it another node's state.
Only what the user did is stored: the file's `size` is read while a split has no dragged sizes, so changing it still moves a split nobody has dragged.
A split somebody has dragged goes back to the file's sizes on a double-click on any of its dividers that drags, which drops its dragged sizes whole; without it the only way back was an edit that changes the split's children.

## The window's own chrome — built, and currently switched off

**The app uses the system's window frame today.** What follows is a complete alternative that exists in the code behind a single flag, `OWN_CHROME` in `main.ts`, and is turned off.

It works, and it was turned off for one reason: dragging the window is visibly steppy. The gesture is the app's own, so every move is a round trip to the compositor, and it cannot be made smooth — handing the drag back to the compositor is smooth, but brings a double-click-to-maximize that draws the window offset from where it hit-tests and cannot be suppressed. That trade was not worth it in daily use.

Both paths are live rather than one being dead code: macOS has always run the system-chrome side of every branch below, because a frameless window there would have no traffic lights. So this describes what turning the flag back on gives, and why each piece is hand-built rather than borrowed from the OS.

With it on, the window is frameless and the app draws its own title bar: a strip across the top carrying the app mark, the version, and the minimize / maximize / close buttons.
macOS is deliberately excluded and keeps its native frame — a Mac window without its traffic lights is one you cannot close, and the variant that would replace them (`titleBarStyle: 'hiddenInset'`, with the sidebar header inset beneath the lights) is not built while nobody can look at a Mac to judge it.
One flag decides all of it, so the two never disagree: the frame, the buttons, the drag and the resize handles all hang off it.

Everything the OS would have done for that window, the app does itself, and each piece exists because the compositor's own version is unusable here rather than as a matter of taste.

**Maximize is `setBounds`, never `maximize()`.** The native call paints a frameless window offset from where it hit-tests, so its controls are drawn in one place and clickable in another. The app therefore never enters the native maximized state and keeps the flag itself.
The rectangle to fill cannot simply be the display's work area, because nothing here publishes one that accounts for the Windows taskbar — so the app asks the window manager the only way it answers, by maximizing a window nobody sees and reading the result back. That answer belongs to whichever display the window manager chose, so it is remembered per display and asked again when an unmeasured one turns up.

**Every edge and corner is a handle the app draws.** Chromium leaves a 4px resize margin on three sides and none at the top, so the top edge could not be resized at all and the other three were a hard target; eight handles at 6px, and 12px at the corners, make them uniform. They clamp to the same minimum size the window enforces, which is one constant rather than two.

**Dragging the window is the app's too, and it stutters.** That is a chosen trade, not an oversight.
Handing the drag back to the compositor — a drag region — is smooth, but it brings a double-click-to-maximize that uses the native maximize above, and that cannot be suppressed or intercepted: the decision is made on the first mousedown, and every route around it either deadlocks the window or leaves it drawing offset.
So the choice is a drag that steps and lands correctly, or a maximized window whose buttons are not where they appear — and since neither is good, the flag is off and the system draws the frame instead.
The gesture itself is one helper shared by moving and by all eight resize handles: it measures in screen coordinates, because the window moves under the pointer; it reports the total offset from where it began rather than per-move deltas, which would each be measured against the previous move's result; it starts only after a few pixels of travel, so a plain click on the bar of a maximized window does not restore it; and it sends at most one change per animation frame.

Two smaller things follow from having no OS title bar. The version and the "dev" marker live in the app's bar, because the window title was the only place they were shown. And a window manager here wraps every window in a 32px invisible frame of its own, which offers a resize affordance it does not honour — nothing in the app can remove it.

## Reopening the way you left it

Two things are restored on launch, and each has one rule worth knowing.

The **window's** size and position are stored as the unmaximized rectangle plus a maximized flag, and are checked against the displays that exist at launch rather than replayed blind: the size is a preference and survives a monitor going away (clamped to the screen it opens on), while the position is dropped whole once it no longer lands somewhere reachable — including a window with only a sliver on screen, or one whose title bar sits above the top edge and could not be dragged back. The geometry decision is a pure function, so those cases are tested rather than reproduced by hand.

The **sidebar's** view — search text, the filter toggles, the date filter, folded projects and groups, scroll offset — is one object written as a whole (its width belongs to the layout tree now; see Panel state), on a debounce, and only when a snapshot differs from the last one stored; renders happen constantly for reasons that have nothing to do with the view. Rolling date presets are recomputed from the current moment, so "last 7 days" still means the last 7 days; only a custom range is restored literally. The filter panel comes back exactly as it was left, an active filter included — closing it over a filter you meant to keep is a choice to reclaim the space, and the filter icon carries an accent whenever anything is on.
The toggle is a funnel rather than a magnifier, because a magnifier promises a search box, which clears when it closes.
Clearing on close was the fix first asked for, and it would have made closing the panel disagree with quitting the app, which restores the filter on purpose.
Closing the panel never hides the filter, though.
Closed over a filter that is on, the panel folds down to one row of chips, one per thing that is on — the search text, each pill, the date range — each with its own ×, and a press on the row opens the panel again; the count and Clear sit on the line below, where they also sit under the open panel.
With nothing on, closing hides it all.
The count and Clear used to sit inside the panel, and a list filtered behind a closed panel read as every session there was, with a dot on a 14px icon left to say otherwise; moving just the count out was tried first and was still not enough, because a count says that something is on and not what.
The count's total is the set the matches were taken from: the same project scope and the same view before the other filters, so the count only ever compares a set with part of itself.
The archived pill picks that set rather than narrowing it, since the archived view holds only archived sessions and the normal view none, so in the archived view the total is the archived sessions and the count says "archived"; in the normal view it is the number the switcher shows.
One rule, `inView` in `logic.ts`, decides which set a session is in for the list, the switcher's counts and the total alike.

Folds come in two states, and they are deliberately separate. Filtering opens the whole tree so a match inside a folded section is never hidden, and folding from there is a way through the results — shut a project you have already been through — rather than a statement about how the sidebar should look. So those folds apply only while a filter is on and are dropped the moment one stops, by any route: Clear, the last character of a search, a date preset going back to Any. Both states are stored, because the filter itself is restored, and coming back to the same results without the same view is the thing remembering the view is meant to prevent.

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

**The project scope holds everywhere.** Selecting a project in the switcher is a statement about what you are looking at, so every surface honours it — the list, the tab bar, the placeholder's wording, and the archived view, which used to be exempt and no longer is.
Switch to All to search or browse across projects; that is what All is for.

**The empty terminal pane names the next action**, and it has four to choose from: no sessions at all, sessions but no tabs in this project, tabs but none selected, and a selected tab that isn't running.
One sentence cannot cover them — it ends up telling someone with no tabs to pick a tab.
Note it counts the tabs actually on screen (`visibleTabs()`, the same helper the bar renders from),
not every open tab.

Any control that opens a menu or popover keeps its active look (the same fill or outline it shows on hover) for as long as the menu is open, including when the pointer moves off it.
The shared `openMenu` helper stamps `.menu-open` on the trigger while its menu is up, so give every such trigger a `.menu-open` style that matches its `:hover`.
The kebabs, both split-button carets (project and group heading), and the sibling-count badge all follow this.

Every menu/popover also reads as attached to its trigger: `openMenu`/`openSubmenu` add an `attach-top`/`attach-bottom`/`attach-right`/`attach-left` class and set `--notch-x`/`--notch-y`, which position a small notch on the menu's edge pointing at the trigger's center.
Anything new that floats near an anchor should go through those helpers so it gets the notch (and the active-state stamping) for free rather than reinventing positioning.

**One appearance, one rule.** Anything drawn on more than one surface is a single class, never parallel rules kept in step by hand.
Parallel rules always drift, and they drift silently: the session mark and the strip mark were the same dot in two classes, and they diverged twice — first to two different sizes, worst on the busy arc, where 7px and 9px read as two different marks rather than one state; then to a hollow ring in the list and a 9px hole in the strip for a session that had not reported yet.
They are now one `.nudge`, with `.nudge.clickable` for the single surface where it is a control rather than a report.
The practical test: **a comment saying "match X exactly", or "same as Y", is a bug report against the stylesheet.** It means the relationship is being maintained by whoever remembers it. Extract the shared rule and let the difference be a modifier.
When a variant genuinely differs — a group heading is deliberately lighter than a project heading — that is a modifier on the shared base, not a second copy of it.

**The tab bar's names are jumps into the list.** A project's name scrolls the session list to that project and a group's to that group, and each flashes the heading it lands on: two labels at two levels doing the same thing, drawn from one shape and one hover rule.
The group's is the function behind the heading's jump menu (`jumpToGroup`), and the project's (`revealProjectInSidebar`) flashes through the same `flash()`.
The flash has no end keyframe, so it fades into whatever the element already has — a project heading's `--bg`, a group heading's `--surface`, an open row's accent bar.
It used to end on `--surface`, which is right only for a group heading, and on anything else it finished by snapping to the element's own colour; that went unnoticed until a project heading was flashed.

### Sizes and shapes

Sizes come from a small set of decisions, not per-component choices. Reach for the existing tier before inventing a value; if something genuinely needs its own, say why in a comment next to it.

**Icons** are inline SVG on a 16-unit viewBox, never font glyphs — a glyph resolves through system font fallback, which is how `⑂` once rendered from a monospace face beside its neighbours.
Ink is centred on (8,8) so flex centring needs no nudge, and stroke width is expressed as the *rendered* px weight (1.3px everywhere) converted to viewBox units per size, so a 9px mark and a 15px one look equally heavy.

**Clickable icons** are 14px, in one of three boxes: **standard** 24×20 (`padding: 2px 4px`) for
sidebar, row and toast controls; **compact** 22×16 (`0 3px`) where density matters, i.e. the tab bar and a panel's header, whose height is fixed at 28px so a panel with a button and one without sit on the same bar;
**large** 32×26 (`5px 8px`) for the header actions.
Each carries a 1px transparent border so the hover/active outline can't resize the box.
Documented exceptions: the note mark (inline inside a 12px text line) and the 9px nudge.

**Composite controls carry a resting border**, single icon controls don't.
The split buttons on the project and group headings are two halves acting as one button, so they need to look like one object before you touch them; outlining them only on hover makes the pair read as two loose icons that suddenly acquire a box.
A single icon needs no such help, and bordering each would put two more boxes on every row and heading.

**Trailing controls sit 4px apart** on every row that has them — the session row's pin and kebab, the group heading's `+` and kebab, the project heading's split button and kebab — so the second-from-right control lines up down the list, not just the last one.
Tight rather than roomy because every pixel there is width the session title loses; the controls' own padding keeps their ink well clear.
Each row reaches 4 from a different base gap (a session row's is 8, a heading's is 6), so the offsets on the kebabs differ — check the total, don't copy the value.

**Hover** is identical for every icon control — `--active` fill, accent border, `--text` glyph — from one shared rule.
It uses `--active` rather than `--surface-hover` because a hovered session row is already `--surface-hover`, so a button filling to the same colour inside it would show no change.
Note that `button:hover` sets the accent border app-wide, so a control whose resting rule is more specific silently opts out of it; that is why the rule lists its selectors explicitly.

**A dialog's decisive button is filled**, in one of two colours of the same shape: `.primary` confirms (accent fill, dark text — the accent is a light blue, so white on it barely separates) and `.danger` destroys (red fill, white text).
Filled rather than outlined because `button:hover` sets an accent *border* app-wide, so a resting accent border is indistinguishable from an ordinary button being hovered — which is how the old accent-outlined Save read, and why it was replaced.
That same app-wide rule is why the hover state has to set the border itself, and it sets it to the fill: background and border are one colour, so the brightness step darkens the whole button and its outline never appears to move.
Each colour is named once, as a `--fill` custom property, which is what keeps that true — an earlier version reached for `currentColor` instead, i.e. the *text* colour, and hovered to a dark border on the blue button (it read as shrinking) and a white ring on the red one.

**Rows** come in two shapes: a **list row** (`.session`) is a card in the list body — `7px 14px`, surface radius, two lines and its own controls; a **menu row** (switcher entry, kebab-menu item, attention-strip session) is `6px 9px`, control radius, one shared rule for all three.

**Radius and type are tokens** in `:root`.
Radius is per kind of thing rather than per component: `--radius-control` (anything you click), `--radius-surface` (rows, cards, panels, popovers, dialogs), `--radius-pill` (fully round, so it never needs re-tuning when its height changes); circles keep 50%.
Type is six steps — `--text-heading` 16, `--text-title` 14, `--text-body` 13, `--text-meta` 12, `--text-small` 11, `--text-badge` 10 — with no half-steps, since 0.5px is a smaller difference than one weight of the same size.

**Inactive** is `--muted` colour, never `opacity`: dimming fades a control's border and background too, which reads as disabled rather than unselected.
`opacity` is reserved for genuinely disabled controls.

**Form controls inherit their typography explicitly.** The UA stylesheet gives every `button`, `input` and `textarea` `font: 400 13.333px Arial`, which is neither the interface font nor a size on the scale — so menus, dialog buttons, the search box and the filter pills all rendered in Arial until one rule set `font-family: inherit` and defaulted the size to `--text-body`.
Anything new that is a form control gets that for free; anything that needs a different step overrides with a token.

**A count wears a pill**, on both the project and the group heading.
It is not decoration: a bare number sits hard against whatever follows it, while a kebab's ink is 2.6px of dots floating in a 24px box, so the same gap in pixels reads as two very different distances.
The pill's own padding puts the digits about where a neighbouring icon's ink falls, which is what makes the spacing look even.
The group's pill fills with `--bg` because its heading bar is already `--surface`.

**Icon-only controls carry a tooltip and an `aria-label`.** The filter pills are icon-only because words cost the panel an extra line at a 320px sidebar; the meaning has to survive that, so both attributes are mandatory rather than optional there.

### Traps worth knowing

**A sticky element pins its MARGIN box, not its border box.** The group headings pin below the project heading; while the `h3` still carried its own `margin-top`, it parked exactly that far too low and left a band of scrolling rows visible between the two.
The space above a group lives on the `.group` section instead, so the heading has no margin to offset it.
The offset itself is the project heading's *measured* height, published as `--project-heading-height` — the same number the jump uses, so the two cannot drift apart, and neither goes stale when the type scale moves.


**`text-box: trim-both cap alphabetic` ends the box at the baseline**, so descenders paint outside it.
Combined with the `overflow: hidden` that any ellipsis needs, it silently clips every `g`, `p` and `y` — which is exactly what happened to the session meta line.
The fix is symmetric vertical padding: it gives the clip box room while keeping cap-top-to-baseline centred, so a mark beside the text stays aligned to its ink.
Measure the font's descent rather than guessing the value.

**A hidden pane measures as the default size, not as nothing.** `FitAddon` sizes from the element's own box, and a `.term` is `display: none` until it is the active tab.
Fitting one before revealing it therefore yields xterm's 80×24 default rather than an error — and that default is what the PTY is told, so `claude` draws its entire TUI to 80 columns for the life of the session.
Reveal, then fit, then resize.
Every conditionally-visible pane carries this hazard, split view included.
The whole terminal area is one now: it is hidden while another panel of its group is shown or its group is folded, so the tab fit refuses a terminal area with no size and leaves it to the `ResizeObserver` on it, which fires once the area has a size again.

**xterm's layers carry z-indexes of their own, up to 10.** A `.term` makes no stacking context by default, so those layers competed with the history lying over the terminal area, painted over it and took its clicks.
Each `.term` is `isolation: isolate` for that reason: nothing inside a terminal can rise above its siblings, whatever number it carries.

**Under WSLg a held mouse button moves as a different pointer.** The press arrives as the mouse, pointer 1, but the moves while the button is down arrive as a pen, pointer 2, and the release as the mouse again (seen in the app's log).
So a drag that captures the pressed pointer, or checks each move's `pointerId` against the press, sees no moves at all, and every headless check passes, since synthesized input keeps one pointer.
The history bar follows every move of a held pointer on the window instead, and ends on any release or on a move with no button down.

**Specificity quietly opts controls out of shared hover rules.** `button:hover` is 0,1,1, so a resting rule like `.project h2 .project-kebab` (0,2,2) or `#toast-close` (1,0,0) beats it and never takes the accent border, while `.session-kebab` (0,1,0) does.
This produced three separate "why does only this one look different" bugs.
When a shared appearance matters, list the selectors explicitly with their own `:hover` so each beats its own resting rule, and check with forced pseudo-states rather than by reading the cascade.

**A signature that lists its inputs is a guard nothing can check — so this one is checked by the compiler.** The sidebar re-renders only when `structuralSignature` changes, which keeps a growing transcript from rebuilding the list. Whether such a signature names *every* field the rows draw is a question about the whole render path, so it cannot be asserted cheaply, and getting it wrong does not churn — it **freezes**, leaving a field stale until something else happens to move.
It had been wrong: `model` was absent while the row printed it, so switching model mid-session showed the old one, and `worktree`/`repoRoot` were covered only by riding along with `cwd`.

The shape that fixes it is `AFFECTS_ROW`, a `Record<keyof SessionSummary, boolean>` naming every field with a yes or a no.
The annotation is the whole mechanism: adding a field to `SessionSummary` **fails to compile** until somebody says whether the list must redraw for it, which turns "did we remember?" into a question the build answers.
Only two are `false`, each with its reason written beside it — `lastActivity`, rewritten on every message of a running session, and `postCompactHeads`, which no row reads.
The general rule this stands for: **where stale is worse than an extra rebuild, make the exhaustive case the one the compiler enforces**, rather than trusting a list to be complete.

**Two surfaces can disagree about the same list, because only one of them re-rendered.** The session list is assigned before that signature check decides whether to draw, so a transcript merely growing updates the data and skips the render.
The attention strip is then rebuilt by the next status event, from the newer list, while the sidebar still shows the older one — which is why the strip appears to reorder itself on a dot changing.
Anything that reads the session list off a status event has the same hazard.

**A list you read while working needs to stay still more than it needs to be sorted well.** The attention strip has had three orders, and the first two both moved under the reader.
Sorting attention-first — sessions by urgency, projects by their most urgent session — reshuffled both levels on every status change.
Ordering it as the *session list* does was closer and still wrong, because the sidebar's own within-project order is **recency**, and every row in this strip is a running session by definition: those timestamps are all moving, so two rows swap whenever the lower one writes a message.

It orders by **tab order** now, which is the only order available here that nothing on disk can touch — it changes when you open, close, drag or regroup a tab, and a drag persists. Projects keep the explicit project order, which is also something you set by dragging, so both levels are yours.
"Tab order" is not the tabs array, though: the bar draws a project's ungrouped tabs first and then one row per group in registry order, so the strip shares that clustering (`orderAsTabs`) rather than reading the array directly. Both call it identically, which is what keeps them from drifting.

**All three surfaces put projects in the same order**, the one you set. The tab bar used to order them by whichever project it met a tab for first — emergent rather than chosen, and it moved on its own: closing a project's last tab and opening another sent that project to the end.
Pins are deliberately not floated here, unlike the sidebar: a pin says where a session belongs in the LIST, the tab bar has never honoured it, and floating one would be a second thing able to move a row you were reading.
The sessions still come from the session list, so a row shows what the sidebar shows; only the order is the tab bar's.
