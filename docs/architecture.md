# Architecture

## Environment

The app targets WSL 2 with WSLg. The Electron app, the `claude` CLI it launches, and the
`~/.claude` session store all live inside the same Linux distribution, so there is no
Windows-to-WSL path translation. WSLg shows the window.

Electron needs `--no-sandbox` under WSL; the `start` script passes it.

It runs on **X11 (Xwayland)**, the Electron default here. Do not switch it to Wayland: with
`--ozone-platform=wayland` the window paints solid white, with or without
`app.disableHardwareAcceleration()`, while a bare Electron window with the same flags paints fine —
so it is something about this window, and it has not been chased down. `--ozone-platform-hint=auto`
picks X11 anyway.

If **every cursor stays an arrow** — no hand over a button, no I-beam over an input — that is WSLg's
pointer state stuck, not the app and not Xwayland. Nothing in CSS or in Chromium's flags will move it
(verified: every control computes `cursor: pointer` correctly). Closing all WSLg windows and
reopening clears it; so does starting and quitting any Wayland client, which cycles Weston's pointer.

## Processes

The standard Electron split, with the renderer locked down:

- **Main** (`src/main`) owns the window, reads the filesystem, and will own the PTYs.
- **Preload** (`src/preload`) exposes a small typed API on `window.claudeUi` through
  `contextBridge`. `contextIsolation` is on and `nodeIntegration` is off, so the renderer
  never touches Node directly.
- **Renderer** (`src/renderer`) is plain DOM, no framework yet, and talks only to the
  preload API.

## Reading sessions

`src/main/sessions.ts` walks `~/.claude/projects/*/*.jsonl`. Each `.jsonl` is one session
transcript with one JSON event per line. For each file it streams the lines to pull the
working directory and the first user message without loading the whole file, counts the
events, and takes last activity from the file mtime. The renderer groups the results by
working directory.

## Build

Two TypeScript projects, because the two sides need different module systems:

- `tsconfig.main.json` — main and preload. `NodeNext` module and resolution, emitted as
  CommonJS (the package has no `"type": "module"`), so `require` and `__dirname` work.
- `tsconfig.renderer.json` — renderer. `ESNext` module with `bundler` resolution and the
  DOM libs.

TypeScript 7 removed the old `moduleResolution: "node"`, so both projects use the newer
values above. Shared types in `src/shared` are type-only, so nothing crosses at runtime.

## Embedded terminal

`@xterm/xterm` in the renderer, backed by `node-pty` in the main process running the real
`claude` binary. `node-pty` is a native module and must be rebuilt against Electron's ABI.
Keeping the real CLI in a PTY is the point: its approval prompts, diffs, and permission
modes stay exactly as they are in a terminal.

### Tab lifecycle: a tab can exist without a process

A tab owns at most one terminal, and `terminalId` is **nullable** — null means the tab is
**cold**: it has its row in the bar, its title and its place in the layout, but no `claude`
behind it. Cold is a first-class state, not an error one.

A tab goes cold in two ways: it is **restored** that way at launch (the app starts nothing on
startup — 20 restored tabs used to mean 20 processes at ~437 MB each), or the user **stops**
the session from the row's kebab. It leaves cold by being activated, which starts it
immediately; there is no separate "start" affordance, because selecting a tab has always meant
"work in this session".

Activating a tab can only ever **resume** it, because the only id it has to work with is the
tab's own. A path that needs different arguments — a new session, a fork's `--fork-session`,
a worktree's `-w` — must therefore select the tab *without* starting it and start it itself.
Getting that backwards launched every new session as `claude --resume new-<timestamp>`, and
the sidebar's own resume path hid it completely: there the guessed id and the real one are
the same value.

Two exits must stay distinguishable. A **user stop** sets a `stopping` flag before the kill, and
the exit handler checks it first: that tab is cooled and kept. **Any other exit** closes the
tab, which is deliberate — it stops a finished session leaving an empty tab behind. A third
case sits in between: an exit within 1500ms of launch is treated as a failed start, and the tab
is kept with the error visible in its terminal.

The cold state is visible in three places, all reading the same `terminalId === null`: the tab
is unfilled rather than dimmed, the session row's left bar and the selected tab's top edge are
`--muted` instead of accent, and the terminal pane explains that clicking the tab resumes it.
Those two marks answer the same question, so they answer it the same way — accent means a live
session, nowhere else.

Where you were is remembered twice, in meta: `activeSession` (which tab to open on at launch)
and `activeSessionByProject` (which to return to when you switch back to a project). The
in-memory `activatedSeq` still decides while a project has something running; the stored map only
matters when nothing does, which after a restart is always. Nothing is meant to be live after a
restart, so the remembered tab is *selected* at launch but not started — a deliberately open
question, since a tab marked active with no process behind it is arguable.

## Status cues

Rather than parse terminal output to guess a session's state, the app drives status from
Claude Code hooks. On startup it writes a hook script and its own settings file to
`~/.config/claude-ui/`, and passes that file to `claude --settings`, whose hooks merge with
the user's own — so claude-ui never writes into `~/.claude/settings.json` (an earlier version
did, and still strips those entries when it finds them).

Four events map to statuses: `UserPromptSubmit` → busy, `Stop` → idle, `Notification` →
waiting, `SessionEnd` → closed. A fifth, `SessionStart`, reports **identity rather than
state**: it tells the app which session a tab is running, at the moment claude starts, so a
new tab stops holding a placeholder id until its first prompt. It never touches the dot —
it also fires on `clear` and `compact`, mid-session, where that would wipe a live status —
and it never overwrites an existing status file, which is what the launch state is seeded
from. Any future hook that carries information rather than a state should follow that shape.

The hooks are scoped to claude-ui: it sets `CLAUDE_UI=1` on the terminals it spawns, and
the hook script no-ops unless that variable is set, so sessions run in a plain terminal are
left untouched. When it does fire, the script writes `~/.config/claude-ui/status/<id>.json`.
The main process watches that directory and pushes updates to the renderer, which shows a
dot per session: busy, idle, waiting, or hollow (`closed` and unknown states have no color).

## App-side metadata and session groups

Everything the app knows that Claude Code doesn't — pins, archived sessions, open tabs, per-project
display names, and custom groups — lives in a `meta.json` under the app's own user-data directory.
The session store is never written to: `~/.claude` is read-only as far as this app is concerned.

Writes are serialized through one queue and land via a temp file renamed over the target, with the
previous good copy kept as a backup, so a crash mid-write can't leave the file half-written. Reads
are tolerant by design: unknown or malformed entries are dropped rather than trusted, and older field
names are still understood, so an older `meta.json` upgrades in place without a migration step.

A **group** is a user-made sub-section inside one project. Membership is one group per session, so it
is stored as a session-id-to-group-id map — a session cannot be in two groups by construction. Groups
carry their own display order, and deleting one only unfiles its members; the sessions are untouched.

Two rules shape how the sidebar draws this. The nested shape (projects, their groups in order, then
the sessions in no group, with pins floated inside whichever section they land in) is computed by a
pure function in the renderer's `logic.ts`, so the ordering rules are unit-tested without a DOM. And
a session created inside a group has no real id until Claude Code reports for it, so the app files it
optimistically under its placeholder id and replaces that with the real membership on adoption —
otherwise a new row would appear outside its group and jump in a moment later.

## UI conventions

Vocabulary, in code and in the UI: a **folder** is a literal directory path; a **project** is the
grouping a session belongs to, keyed by its repo root, which merges a repo's worktrees and
subdirectories into one entry; a **group** is a user-made sub-section inside a project. The three are
not interchangeable — one project spans several folders, which is why the switcher, the session list
and the tab bar all say "project".

**The project scope holds everywhere.** Selecting a project in the switcher is a statement about
what you are looking at, so every surface honours it — the list, the tab bar, the placeholder's
wording, and the archived view, which used to be exempt and no longer is. Switch to All to search
or browse across projects; that is what All is for.

**The empty terminal pane names the next action**, and it has four to choose from: no sessions at
all, sessions but no tabs in this project, tabs but none selected, and a selected tab that isn't
running. One sentence cannot cover them — it ends up telling someone with no tabs to pick a tab.
Note it counts the tabs actually on screen (`visibleTabs()`, the same helper the bar renders from),
not every open tab.

Any control that opens a menu or popover keeps its active look (the same fill or outline it
shows on hover) for as long as the menu is open, including when the pointer moves off it. The
shared `openMenu` helper stamps `.menu-open` on the trigger while its menu is up, so give every
such trigger a `.menu-open` style that matches its `:hover`. The kebabs, both split-button carets
(project and group heading), and the sibling-count badge all follow this.

Every menu/popover also reads as attached to its trigger: `openMenu`/`openSubmenu` add an
`attach-top`/`attach-right`/`attach-left` class and set `--notch-x`/`--notch-y`, which position a
small notch on the menu's edge pointing at the trigger's center. Anything new that floats near an
anchor should go through those helpers so it gets the notch (and the active-state stamping) for
free rather than reinventing positioning.

### Sizes and shapes

Sizes come from a small set of decisions, not per-component choices. Reach for the existing tier
before inventing a value; if something genuinely needs its own, say why in a comment next to it.

**Icons** are inline SVG on a 16-unit viewBox, never font glyphs — a glyph resolves through system
font fallback, which is how `⑂` once rendered from a monospace face beside its neighbours. Ink is
centred on (8,8) so flex centring needs no nudge, and stroke width is expressed as the *rendered* px
weight (1.3px everywhere) converted to viewBox units per size, so a 9px mark and a 15px one look
equally heavy.

**Clickable icons** are 14px, in one of three boxes: **standard** 24×20 (`padding: 2px 4px`) for
sidebar, row and toast controls; **compact** 22×16 (`0 3px`) where density matters, i.e. the tab bar;
**large** 32×26 (`5px 8px`) for the header actions. Each carries a 1px transparent border so the
hover/active outline can't resize the box. Documented exceptions: the note mark (inline inside a 12px
text line) and the 9px status dot.

**Composite controls carry a resting border**, single icon controls don't. The split buttons on the
project and group headings are two halves acting as one button, so they need to look like one object
before you touch them; outlining them only on hover makes the pair read as two loose icons that
suddenly acquire a box. A single icon needs no such help, and bordering each would put two more boxes
on every row and heading.

**Trailing controls sit 4px apart** on every row that has them — the session row's pin and kebab, the
group heading's `+` and kebab, the project heading's split button and kebab — so the second-from-right
control lines up down the list, not just the last one. Tight rather than roomy because every pixel
there is width the session title loses; the controls' own padding keeps their ink well clear. Each row
reaches 4 from a different base gap (a session row's is 8, a heading's is 6), so the offsets on the
kebabs differ — check the total, don't copy the value.

**Hover** is identical for every icon control — `--active` fill, accent border, `--text` glyph — from
one shared rule. It uses `--active` rather than `--surface-hover` because a hovered session row is
already `--surface-hover`, so a button filling to the same colour inside it would show no change.
Note that `button:hover` sets the accent border app-wide, so a control whose resting rule is more
specific silently opts out of it; that is why the rule lists its selectors explicitly.

**Rows** come in two shapes: a **list row** (`.session`) is a card in the list body — `7px 14px`,
surface radius, two lines and its own controls; a **menu row** (switcher entry, kebab-menu item,
attention-strip session) is `6px 9px`, control radius, one shared rule for all three.

**Radius and type are tokens** in `:root`. Radius is per kind of thing rather than per component:
`--radius-control` (anything you click), `--radius-surface` (rows, cards, panels, popovers, dialogs),
`--radius-pill` (fully round, so it never needs re-tuning when its height changes); circles keep 50%.
Type is six steps — `--text-heading` 16, `--text-title` 14, `--text-body` 13, `--text-meta` 12,
`--text-small` 11, `--text-badge` 10 — with no half-steps, since 0.5px is a smaller difference than
one weight of the same size.

**Inactive** is `--muted` colour, never `opacity`: dimming fades a control's border and background
too, which reads as disabled rather than unselected. `opacity` is reserved for genuinely disabled
controls.

**Form controls inherit their typography explicitly.** The UA stylesheet gives every `button`,
`input` and `textarea` `font: 400 13.333px Arial`, which is neither the interface font nor a size on
the scale — so menus, dialog buttons, the search box and the filter pills all rendered in Arial until
one rule set `font-family: inherit` and defaulted the size to `--text-body`. Anything new that is a
form control gets that for free; anything that needs a different step overrides with a token.

**A count wears a pill**, on both the project and the group heading. It is not decoration: a bare
number sits hard against whatever follows it, while a kebab's ink is 2.6px of dots floating in a 24px
box, so the same gap in pixels reads as two very different distances. The pill's own padding puts the
digits about where a neighbouring icon's ink falls, which is what makes the spacing look even. The
group's pill fills with `--bg` because its heading bar is already `--surface`.

**Icon-only controls carry a tooltip and an `aria-label`.** The filter pills are icon-only because
words cost the panel an extra line at a 320px sidebar; the meaning has to survive that, so both
attributes are mandatory rather than optional there.

### Three traps worth knowing

**A sticky element pins its MARGIN box, not its border box.** The group headings pin below the
project heading; while the `h3` still carried its own `margin-top`, it parked exactly that far too
low and left a band of scrolling rows visible between the two. The space above a group lives on the
`.group` section instead, so the heading has no margin to offset it. The offset itself is the project
heading's *measured* height, published as `--project-heading-height` — the same number the jump uses,
so the two cannot drift apart, and neither goes stale when the type scale moves.


**`text-box: trim-both cap alphabetic` ends the box at the baseline**, so descenders paint outside it.
Combined with the `overflow: hidden` that any ellipsis needs, it silently clips every `g`, `p` and `y`
— which is exactly what happened to the session meta line. The fix is symmetric vertical padding: it
gives the clip box room while keeping cap-top-to-baseline centred, so a mark beside the text stays
aligned to its ink. Measure the font's descent rather than guessing the value.

**Specificity quietly opts controls out of shared hover rules.** `button:hover` is 0,1,1, so a resting
rule like `.project h2 .project-kebab` (0,2,2) or `#toast-close` (1,0,0) beats it and never takes the
accent border, while `.session-kebab` (0,1,0) does. This produced three separate "why does only this
one look different" bugs. When a shared appearance matters, list the selectors explicitly with their
own `:hover` so each beats its own resting rule, and check with forced pseudo-states rather than by
reading the cascade.
