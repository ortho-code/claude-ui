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

## Reading sessions

`src/main/sessions.ts` walks `~/.claude/projects/*/*.jsonl`.
Each `.jsonl` is one session transcript with one JSON event per line.
For each file it streams the lines to pull the working directory and the first user message without loading the whole file, counts the events, and takes last activity from the file mtime.
The renderer groups the results by working directory.

## Build

Two TypeScript projects, because the two sides need different module systems:

- `tsconfig.main.json` — main and preload. `NodeNext` module and resolution, emitted as CommonJS (the package has no `"type": "module"`), so `require` and `__dirname` work.
- `tsconfig.renderer.json` — renderer. `ESNext` module with `bundler` resolution and the DOM libs.

TypeScript 7 removed the old `moduleResolution: "node"`, so both projects use the newer values above. Shared types in `src/shared` are type-only, so nothing crosses at runtime.

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
An action that cannot be taken is shown rather than removed: a menu that changes shape has to be re-read, and an item that vanishes looks like it was never there, where a dimmed one answers the question you opened the menu to ask.

**Unavailable is `aria-disabled`, never the `disabled` property**, and the reason is the tooltip: a natively disabled button emits no mouse events in Chromium, so a tooltip delegated from `document` never fires and the only thing explaining the refusal is invisible. `setUnavailable()` marks a control and carries the reason; the click handler refuses with `unavailable()`, which is the trade for a tooltip that works.
**Management stays**: pin, note, archive and delete all keep working, because cleaning up after a folder that has gone is exactly when you need them.
One function produces that sentence and the tooltip, the toast and the pane all use it, so they cannot drift.

Two cases no amount of gating can pre-empt — a folder that disappears while the app is running, and a tab you are already sitting on — which is why the refusal still has to explain itself when it happens.
A tab is kept, cold, rather than closed: the click meant "look at this", and the folder may come back.

(`claude -w` also `git worktree lock`s the tree it cuts, and that lock outlives the session, so a later `git worktree remove` refuses until the lock of a dead pid is cleared.)

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

## Panels

A layout file arranges the whole window: rows and columns of panel groups, with the sidebar and the terminal area as two of the panels.
Per-project and named layouts are the next steps of the same design, and the file's shape leaves room for them.

### The config folder

Everything a person may edit or share lives in ONE folder, `config/` under the app's data directory, and nothing else does: the layout file at `layouts/default.json`, and the scripts it points at under `scripts/`.
It sits apart from `meta.json` and the status files on purpose.
Those are machine state the app writes, which nobody should edit and nobody would want to hand a colleague; this folder is the opposite on every count, so "copy this folder" hands over exactly the customisation and none of the state.
`layouts/` is a directory rather than a single `layout.json` so that named and per-project layouts can be added beside the default instead of by moving it.

The app creates the folder, reads it and watches it, and in this version never writes into it.
That is what keeps an editor, id assignment, normalisation and an atomic-write path out of the slice, and it also settles the trust question for now: a command in a hand-edited file is the user's own, and a trust step arrives with the first thing that lets a command reach the file by another route — the app's own editor, or a shared folder.
The settings dialog shows the folder's path with a Reveal button, which is the whole of the UI for finding it.
It opens the folder itself (`shell.openPath`) rather than showing it selected in its parent (`showItemInFolder`): a Linux file manager without FileManager1 support, which is what WSLg offers, opens the parent and selects nothing, which reads as the wrong folder.

Three directories are watched rather than the folder recursively (recursive watch is unreliable on Linux and WSL, as the session watcher found): the folder, `layouts/`, and `scripts/`.
An event on the folder itself re-opens the two below it, because a directory deleted and recreated leaves its old watcher pointing at nothing.
`scripts/` is watched so that a script appearing, or gaining its executable bit, clears the panel's error without a restart; that an attribute change reaches a directory watch was measured rather than assumed.

### The layout file

The file is ONE TREE, and the app's own surfaces are nodes in it: `{ "version": 2, "root": … }`, where every node has an `id` and exactly one of `rows`, `columns` or `panels`.
A node with `rows` or `columns` is a split; a node with `panels` is a **panel group**, which shows one panel at a time.
"Panel group" is the layout's word, and a plain "group" stays the session list's (see UI conventions); the two are unrelated.
The first shape of the file, one panel beside the terminal, never shipped, so version 1 is refused with a notice rather than converted.

A panel is an ENTRY in a group, not a file of its own: `{ "id": "status", "type": "command", "command": "git status --short" }`.
That is the shape of Claude Code's own statusline and hooks, and it keeps sharing at its simplest — a line pasted from one file into another.
Every id, of a node or an entry, is a slug the user writes (lowercase letters, digits, hyphens and underscores) and unique across the whole file, because ids are what the window's state keys on: dragged sizes, folds, the panel picked in a group.
The app assigns nothing, because it writes nothing.

The tree is hand-built from flex containers rather than taken from a docking library.
What it needs — splits, dividers, a rail, folding — is small and already in the app's own vocabulary; what a library is for, dragging panels between groups and floating them, is deliberately not wanted, since the file is the editor.
The file stays engine-agnostic, so a library could replace the renderer later without a layout changing.

**Every mistake in the file is named, in the place of the thing that is wrong, and nothing is dropped or guessed.**
This is the opposite of meta's rule, and for the opposite reason: meta drops what it does not understand because the app wrote that file and a past version's field is noise, while this file was written by a person, so what the app does not understand has to be said back to them or they go looking for the bug somewhere else.
A node whose own fields are wrong — none or several of `rows`, `columns` and `panels`, an empty list, a size it cannot read, a field it does not know — becomes a degraded group in its place, listing every problem rather than the first.
An entry's problems show in its slot, and a mistake that is no reason to refuse a panel, such as an icon the app does not have, is a note under the group instead.
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

A `collapsible` group folds from a chevron on a divider.
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
Clicking an icon shows that panel and unfolds the group; the shown panel's own icon does nothing, so the chevron stays the one fold control.
A panel's own marks — the busy mark, the run's last word, its button — sit in a header over it, unless its type is bare.

The fold control and the switcher each live in one function in `tree.ts` (`foldControls`, `switcher`), so trying one of the other variants from the mock — a header button, a tab strip — is a local change there, and none of it is in the file format.

### A layout change keeps panels running

The tree is rebuilt on every layout change, fold and panel switch, but a panel never is: mounted panels are kept by entry key and moved into their new place.
A panel is mounted afresh only when its type or its declared parameters change (`mountSignature`, tested), so a new title, icon or position moves a running command or shell rather than restarting it, and a save that adds a panel restarts nothing else.
Moving an element resets its scroll offsets and drops its focus, so a rebuild carries both across.

A panel behind another in its group, or in a folded group, keeps its DOM and its process: hiding stops nothing, and only removal from the file does.
A `command` panel does not run while hidden; a context change meanwhile is remembered as a difference, and it runs once when shown — and not at all if the context came back to where its last run was (`RunGate`, tested).
A `terminal` keeps its shell and refits from its own `ResizeObserver` once it has a size again.

At start-up the default layout is drawn before the first paint, the file is read before a single row is drawn — so the sidebar and terminal area are moved into the tree while they are still empty — and panels are shown only once the tabs are restored, so a panel's first run is in the restored tab's folder.

### A type declares its parameters once

A panel type is a module under `src/renderer/panels/types/`, and it declares its parameters in one place: name, kind (`text` or `path`), what a `path` resolves against, and which groups of parameters are exactly-one-of — with its default icon, whether it is bare, and whether it is a built-in the layout must place once.
The validator, the degraded panel's wording and, later, an editor's form all read that one declaration, so a parameter cannot be known to one of them and not the others.
The type also owns its panel's body and its run; the tree (`tree.ts`) draws only what is around it — the header, the rail icon and its dot, the dividers.

### The `command` type

It runs something and shows what it printed, and it takes its command in one of two ways, exactly one required.
`command` is a command line, run by a fresh copy of the user's shell as they typed it, so pipes and quoting are the shell's business.
`script` is a path to an executable, relative to the config folder or absolute, passed to the shell as ONE argument with no parsing of the path, so a space in it is nothing.
The type kept the name `command` for both: a one-liner is not a script and a script is not a command line, and Claude Code's statusline and hooks say `"type": "command"` for either.

A script is checked when the layout is READ, not when it runs, and by the main process, which has the filesystem: "not found" and "not executable" travel in the same report as the file's shape, so one read answers everything about the file.
The resolver is one function used by the check and by the run, so the two cannot disagree about which file was meant.

The command runs in the panel's CONTEXT DIRECTORY — the active tab's cwd, else the selected project's repo root — so a worktree session's panel reports the worktree.
That is the one thing that differs between the two forms: a relative path INSIDE a command line is resolved by the shell against that directory, while a relative `script` resolves against the config folder, so the script travels with it.
The context reaches the command as environment variables only for now (`CLAUDE_UI_PROJECT_ROOT`, `CLAUDE_UI_CWD`, `CLAUDE_UI_SESSION_ID`, `CLAUDE_UI_CONFIG_ROOT`); JSON on stdin joins when a second type wants it.
With neither a tab nor a project the panel says "Pick a project to run this in." and runs nothing.
It runs when first shown, on Refresh, and when the context directory changes, which a tab switch, a project switch and stopping the tab you are on all do — but never while hidden (see A layout change keeps panels running).

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
No parameters.

**It stays put.** The shell starts in the context directory of the moment the panel first shows and stays there through tab and project switches.
A shell has state — the command you have running in it — so following the context the way the `command` panel does would kill that command on every switch, and one shell per directory kept alive and swapped like tabs is a lifecycle that belongs with groups and tabs, not here.
So the header names the folder the shell is in, the button is "Restart here", which kills the shell and starts one in the current context, and the one exception is a panel with no shell because there was nothing to run in, which starts as soon as a context appears.
The type declares that button's label itself, so the tree keeps one button and the type says what it does.

**The same pty path as a session.** `terminal.ts` has one spawn for both — the terminals map, the data and exit routing, the stop escalation and the quit sweep — with the claude-specific argument building and the plain-shell start as two callers of it.
A panel's shell is therefore stopped and swept exactly as a session is, and nothing about it is a second implementation of a process the app runs.
It gets the `CLAUDE_UI_*` context in its environment and `COLORTERM=truecolor` as a session does, and NOT `CLAUDE_UI=1`: a `claude` started by hand in it must not report as one of the app's sessions.

**One xterm, one router.** The renderer's `terminal.ts` builds every xterm in the window (the font tokens, the neutral foreground, the canvas fallback, clickable links) and routes every terminal's output and exit to whichever sink bound its id, a tab or a panel.
The tab's claude-specific key handling — Ctrl+Enter and Shift+Enter as newline, Ctrl+Z refused, Ctrl+C twice to close — stays with the tab.
A panel fits its xterm from a `ResizeObserver` on its own box rather than at mount, because it is mounted before the tree has placed it and the box measures nothing yet: the hidden-pane trap, in its "not yet placed" form.
The same observer covers every later reveal — a switch on the rail, an unfold, a divider reopening a squeezed node — since each gives the box a size again.

### Panel state

Where the tree was left lives in `UiState.panelState`, per machine, and never in the layout file, which is what may be shared: the dragged sizes per split and child, the folded groups, and the panel picked in each group, all keyed by the file's ids.
So an edit that renames a node starts it fresh rather than handing it another node's state.
Only what the user did is stored: the file's `size` is read while a split has no dragged sizes, so changing it still moves a split nobody has dragged.

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

Every menu/popover also reads as attached to its trigger: `openMenu`/`openSubmenu` add an `attach-top`/`attach-right`/`attach-left` class and set `--notch-x`/`--notch-y`, which position a small notch on the menu's edge pointing at the trigger's center.
Anything new that floats near an anchor should go through those helpers so it gets the notch (and the active-state stamping) for free rather than reinventing positioning.

**One appearance, one rule.** Anything drawn on more than one surface is a single class, never parallel rules kept in step by hand.
Parallel rules always drift, and they drift silently: the session mark and the strip mark were the same dot in two classes, and they diverged twice — first to two different sizes, worst on the busy arc, where 7px and 9px read as two different marks rather than one state; then to a hollow ring in the list and a 9px hole in the strip for a session that had not reported yet.
They are now one `.nudge`, with `.nudge.clickable` for the single surface where it is a control rather than a report.
The practical test: **a comment saying "match X exactly", or "same as Y", is a bug report against the stylesheet.** It means the relationship is being maintained by whoever remembers it. Extract the shared rule and let the difference be a modifier.
When a variant genuinely differs — a group heading is deliberately lighter than a project heading — that is a modifier on the shared base, not a second copy of it.

### Sizes and shapes

Sizes come from a small set of decisions, not per-component choices. Reach for the existing tier before inventing a value; if something genuinely needs its own, say why in a comment next to it.

**Icons** are inline SVG on a 16-unit viewBox, never font glyphs — a glyph resolves through system font fallback, which is how `⑂` once rendered from a monospace face beside its neighbours.
Ink is centred on (8,8) so flex centring needs no nudge, and stroke width is expressed as the *rendered* px weight (1.3px everywhere) converted to viewBox units per size, so a 9px mark and a 15px one look equally heavy.

**Clickable icons** are 14px, in one of three boxes: **standard** 24×20 (`padding: 2px 4px`) for
sidebar, row and toast controls; **compact** 22×16 (`0 3px`) where density matters, i.e. the tab bar;
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
