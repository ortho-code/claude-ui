# Panels

## Panels

A layout file arranges the whole window: rows and columns of panel groups, with the sidebar and the terminal area as two of the panels.
Per-project and named layouts are the next steps of the same design, and the file's shape leaves room for them.

### The config folder

Everything a person may edit or share lives in ONE folder, `config/` under the app's data directory, and nothing else does: the settings in `settings.json`, their changes to the needs-you types among them ([§ Status cues](status-cues.md#status-cues)), the layout file at `layouts/default.json`, the scripts it points at under `scripts/`, and panel types of the person's own under `panel-types/`.
It sits apart from `meta.json` and the status files on purpose.
Those are machine state the app writes, which nobody should edit and nobody would want to hand a colleague; this folder is the opposite on every count, so "copy this folder" hands over exactly the customisation and none of the state.
`layouts/` is a directory rather than a single `layout.json` so that named and per-project layouts can be added beside the default instead of by moving it.

Every file in it is JSONC, the format of VS Code's settings: JSON that may also carry comments and trailing commas, so a plain JSON file reads unchanged and a person can say in the file why something is there.
It is read in one place (`src/main/jsonc.ts`, on `jsonc-parser`), for the settings, the layout and every type's manifest alike.
That parser reads on past a mistake and hands back what it could make of the rest, which is not what anybody wrote, so any error at all means the file does not parse, and only the first is named, by line and column: the ones after it are mostly its echo.
What decided it over JSON5 and YAML is that the same parser changes a value in a file as an edit of its text, keeping every comment around it, which was tried before it was chosen; YAML is a much larger format besides, with indentation that means something and words like `no` that read as false.

**A file a person writes is theirs, and the app writes into one of them only: `settings.json`, at a launch that finds none, when Settings saves, and in the one-time moves into it below.**
Where the app has something of its own to keep beside a person's file, it goes in a file of its own named like it with `.local.json` — `layouts/default.local.json` beside the layout, where the layout was left on this machine — and the app's file wins, the way Claude Code's own `settings.local.json` wins over its `settings.json`.
The layout keeps the pair because it is written on every drag, fold and rail click: one file rewritten that often would change a file somebody has open in an editor under them, could not be written while they were halfway through an edit, and would carry this machine's sizes wherever it went.
The settings were a pair too until 2026-10-22, `settings.local.json` beside `settings.json`, and are one file now: they are written only when Settings saves, where none of that weighs much, and the pair cost every setting lines saying which file its value came from, with a button back to the other.
The app's file holds nothing secret, only where a layout was left on this machine, so it may be shared too: "yours" and "the app's" say who writes each, not which one leaves the machine.
Every write goes through one module (`src/main/appfiles.ts`), which refuses any path but `settings.json` and a `.local.json` inside the folder, so that rule is held by the code rather than by whoever calls it.
A write is an edit of the file's text (`jsonc-parser`'s `modify`), never a rewrite of its value, so whatever a person wrote, comments included, stays: changing a value keeps every comment and the formatting, a key added to an object written on one line spreads that object over several, and a key removed takes along what lies between it and the key before it, such as a comment at the end of that key's line — all three measured, and the last is why a save never removes a key from `settings.json`.
A file a person has left not parsing, or holding no object, is not written over: the write is refused, saying what is wrong with the file.
Each write keeps the previous good copy, where there was a file before it, and the file as the outgoing version left it the first time a new version writes, in `backups/config/` under the app's data directory rather than in the folder; which version last wrote each file is kept there beside its copies, since neither file carries a version of its own.

The settings are read by `src/main/settings.ts` by rules main and the window's checks share (`src/shared/settings.ts`): a setting is the value `settings.json` gives it, or the built-in default where it gives none that can be used.
Settings saves into `settings.json` a setting whose value changed, or whose value in the file is not used, and never a key only to repeat the default; it says once, under its title, where its settings are saved.
**Settings is in sections** (decided 2026-11-08): General, Sessions, Appearance, Version control and Logs, a vertical tab list beside the one on show, every section in one box sized by the window alone, up to a cap and down to a floor, so switching never moves Save under the pointer; a section joins the list once it has something to show.
A section's name stays pinned while its settings scroll, in the look of the session list's project heading, and a part's name, such as GitHub's in Version control, pins under it in the look of a group's bar.
One Save serves every section, an edit kept while another is on show, and Save can be pressed only while a save would write something, each such setting marked with an accent bar down its left edge and each section holding one with an accent dot in the list, beside the mistake's red one: both follow `fileChanges`, the rule the save writes by, so an edit put back is no change, and a value of the file's that is not used is one, since saving puts the field's value in its place; a save the dialog itself refuses over a field shows that field's section, and one main refuses, such as over a setting the file names twice, says why over the buttons, whatever section is on show; Settings opens on the section last shown while the app runs, General after launch, never stored.
Version control holds GitHub as a part under its own heading, so another forge's provider adds its own part there rather than a section named for one forge.
A part Settings shows but has no field for, such as the approvals or the dots' order and looks, names its key in `settings.json` and has the config folder's Open under its words, any mistake in it named below that, never the file's Open: on Linux, Electron 43.2.0's `shell.openPath` hands a file to `xdg-open` without waiting and never settles its promise once that started, so nothing could say a file did not open, and the WSLg machine it was built on had no application `xdg-open` would start for JSON (no default for `application/json`, no desktop environment, no `run-mailcap` and no browser on the PATH; read from the script, not run).
**Under every setting whose value in force differs from the app's default, or whose value in the file is not used, Settings says the default and offers a Reset** (`changedSettings`, design decision 40 of 2026-11-04, built 2026-11-08), a `needsYou` id on its own row under Needs you, counted only for the fields it gives a value other than what the app ships (`needsYouChanges`), so an id named to no effect, such as `{}` or `{ "enabled": true }` on a type that is on, is no change; nor is a default written by the starter file, or a value that reads as the default, such as `runningSessionsAtLaunch`'s `"pause"`.
The overview is a switch at the foot of the list of sections, Only what differs, which narrows every section to those settings, counts them per section in the list and quietens a section with none; it is kept while the app runs, as the section on show is (decided 2026-11-08, on seeing a section of its own, Changed from the defaults, in use: what differs belongs at the setting, where it is changed, and a section of its own repeated every setting a second time).
Reset puts the default in place as an edit does, in the setting's field where it has one and otherwise among what the save adds to the fields' values, a `needsYou` id by emptying its entry to `{}`; Save writes it as the default's value, never by taking a key out, since taking a key out takes the comment before it along (above), and Cancel drops it.
A setting whose value is an object is written entry by entry where the file's value is used (`fileEdits`), so a Reset of one `needsYou` id edits that entry alone and the comments around the others stay; written whole, as before, it lost every comment inside the value.
So that a save of an object setting as it stands writes nothing, two values are compared key by key (`sameValue`), not as the same object; and since main tells the window of no write of its own, a save takes the needs-you categories and types left in force from its own answer.
A mistake in the file is named in Settings: a value of the file's that is not used under its setting, its section marked in the list of sections so a mistake in one not on show is not missed; what concerns the file rather than one value it uses (it does not parse or holds no object, a key the app does not have, a setting named twice) under the title, over whichever section is on show; the log says what is wrong without a flag's value; and a file that does not parse keeps what it last read in force, as the layout file does, and is toasted until it parses.
A setting the file names more than once is such a mistake too: the parser keeps the last, while an edit reaches the first, so a save that would write that setting is refused, saying so, rather than seeming to work and changing nothing in force, and the move from `settings.local.json` below waits as it does for a file that does not parse.
The file is read afresh whenever asked for, a session's start included, so an edit counts from the next session on.
A launch that finds no `settings.json` writes one with every setting at its default, under a line saying what each is, so that launch leaves a file to edit by hand (decided 2026-10-22); a default written out is pinned, as a value written by hand is, so a later version's new default is in force only where its line is taken out, or holds a value that cannot be used.
Writing it only with the first save that changes something left nothing to find, and a file with every setting commented out pinned no default but showed no value in force.
It is written before the moves that follow, which write their values over it.
The launch flags were kept in `meta.json` before; the first launch that has the folder moves them into `settings.json`, once, where the file's are the default, whether the starter wrote them or a person did.
What Settings had saved into `settings.local.json` is moved into `settings.json` the same way, once, the app's value over the file's since it won, and `settings.local.json` is taken away, its text kept in `backups/config/`; a launch where either file does not parse, or `settings.json` holds no object or names a setting the move would write more than once, leaves the move for the next, and until it is made what `settings.local.json` holds is not in force.

A command in a hand-edited file is the user's own, and a trust step arrives with the first thing that lets a command reach a file by another route than their editor, such as an editor in the app.
A type folder a colleague shared was decided (2026-09-29) to need none: it runs as you, the way a script in `scripts/` does, and what makes that acceptable is that a type can do nothing beyond running its script without being pressed (see Types from the config folder).
A `settings.json` from somebody else was decided (2026-10-05) to need none either, its launch flags included, though they reach every session you start without a press: what a shared settings file says is for its reader to check, as it is with Claude Code's own, and Settings shows it.
Settings' General section shows the folder's path with an Open button, and the parts it shows but cannot change open the same folder, which is the whole of the UI for finding it.
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

Two built-in types exist: `sessions`, the whole sidebar (switcher, actions, filter, list), and `claude`, the terminal area (tab bar and terminals).
Each is ONE element for the run, moved into the group that places it and parked in a hidden holder if the layout lets go of it — never rebuilt and never disposed, so a layout change keeps every running session and its xterm exactly as they were.
A change that remounts its entry, a new id or an option, puts that same element back, so a built-in needs no hook of its own for its options: its mount is handed the entry as it now is.
Each is a type of its own, in a folder of its own with its stylesheets: the terminal area in `src/renderer/panels/types/claude/` (the tabs' terminals, the pane, the tab bar, the history and the attention toasts), and the sidebar in `src/renderer/panels/types/sessions/` (the switcher, the filter, the list, and the part of the stored view that is the sidebar's).
Each builds its markup when its modules load rather than on its first mount, because its surfaces read their elements as they load; the tree mounts both as it first draws, so nothing would change if it waited.
Each part builds its own as its module loads, through `fromMarkup` and `byId` (`dom.ts`) — in the sidebar the switcher, the filter and the list, in the terminal area the tab bar, the terminals and the pane — and the type's `index.ts` puts them together, the sidebar's with the header's two buttons that are the type's own, so no part reads an element it did not build, and the imports run one way, from the whole to its parts.
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
The tab bar folds from the same chevron, on a line under it ([§ UI conventions](ui-conventions.md#ui-conventions)), so how it looks is one helper and one stylesheet (`fold-chevron.ts`, `fold-chevron.css`), and where it sits across its line, and when that line counts as pointed at, are each surface's.

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
The dot is the status dot the rest of the app uses (`.nudge`), with one state of its own for a failed run; a session's state shows there as a plain dot of its look's colour ([§ Status cues](status-cues.md#status-cues)).
Clicking an icon shows that panel and unfolds the group, and clicking the shown panel's own icon folds the group, as VS Code's activity bar does, so a panel is put away from the icon that brought it out.
That icon used to do nothing, which kept the chevron the one fold control; both now call the one fold (`toggleFold`), so they cannot fold a group two ways, and the icon's tooltip and its `aria-label`, one string, say it folds.
In a group that cannot fold the shown icon still does nothing, and has neither a pointer nor a hover to suggest otherwise.
A panel's own marks — the busy mark, the run's last word, its button — sit in a header over it, unless its type is bare.
A panel can put tabs in that header in place of its title (`PanelHost.setTabs`, § The `terminal` type).

The fold control and the switcher each live in one function in `tree.ts` (`foldControls`, `switcher`), so trying one of the other variants from the mock — a header button, a tab strip — is a local change there, and none of it is in the file format.

### Full screen

Any panel the layout accepts fills the window from a button the tree makes for it, and the same button brings the layout back (decided 2026-11-08); an entry the layout refuses is drawn as its problems, with no button.
It sits in the header the tree draws, and a bare panel places it in its own bar (`PanelHost.fullScreenButton`): the sidebar at the end of its header, after + New, the terminal area at the end of its tab bar.
The sidebar's filter toggle and collapse-all sit on the row under its header, after Review, rather than in the header: they are the list's, the filter's over the panel it opens, and the header keeps its room for the switcher.
Which panel fills the window is the tree's own state (`fullScreen` in `tree.ts`), applied by every render, since a render rebuilds every split and header and would drop anything set on them by hand.
Each split on the way to that panel shows only the child holding it; the siblings and the dividers stay placed and hidden, as a folded group's content does, so every panel keeps its DOM and its process, and a terminal refits on the way back as it does after an unfold.
Only that panel is on show, so every other one is told it is hidden, and its group draws no rail, so nothing switches or folds until the layout is back.
Nothing of it is written: the sizes, folds and picks in the app's file stay as they were, and full screen is off at every launch, since a window that opens on one panel with the rest hidden and nothing saying why is the confusing case.
A panel the layout lets go of, hides or refuses ends full screen; one that says itself it cannot run stays full screen, showing why.
Bringing a panel into view (`PanelHost.bringIntoView`) is the tree's one answer to "show this panel": the layout back when another panel fills the window, the panel's group unfolded, and the panel shown in its group, the fold and the pick kept as a rail click keeps them.
Opening a session, from a row, a panel, a menu or a toast, brings the terminal area into view first, so its tab is on screen; a toast floats over the whole window, so it asks for that itself.
Inside a full-screen terminal area, switching tabs keeps it full screen, and the session list keeps in step behind it, as it does behind a folded sidebar; a press that asks to see the list, such as Show in list or a project's name in the tab bar, brings the layout back (revised 2026-11-08: it did nothing visible there, which read as broken, and a fold and a full screen now answer that press alike; [§ A session's menu holds everything about it](terminal.md#a-sessions-menu-holds-everything-about-it)).

### A layout change keeps panels running

The tree is rebuilt on every layout change, fold and panel switch, but a panel never is: mounted panels are kept by entry key and moved into their new place.
A panel is mounted afresh only when its type or its `options` change (`mountSignature`, tested), so a new title, icon or position moves a running command or shell rather than restarting it, and a save that adds a panel restarts nothing else.
The signature is whatever sits under `options`, with its keys sorted, so it knows no type's options and reordering them restarts nothing.
Moving an element resets its scroll offsets and drops its focus, so a rebuild carries both across.

A panel behind another in its group, or in a folded group, keeps its DOM and its process: hiding stops nothing, and only removal from the file does.
A context change runs a hidden panel that has run before, as it runs a shown one, and runs nothing where the run would go where the last one went (`RunGate`, tested); one that has not run yet runs when first shown.
Until 2026-10-30 a context change never ran a hidden panel, only noted the difference for its next reveal, so a folded panel's count on its rail stayed the folder's before the switch until it was opened or its interval next ran it, and a count from another folder says something false, as one that stops does.
The count follows once the switch's run ends with a list; while it goes, or when it fails, the last list's count stays, as it does on show.
One with an `interval` runs on it while hidden all the same (§ The `command` type).
A `terminal` keeps its shells, and each refits from its own `ResizeObserver` once it has a size again.

At start-up the default layout is drawn before the first paint, the file is read before a single row is drawn — so the sidebar and terminal area are moved into the tree while they are still empty — and panels are shown only once the tabs are restored, so a panel's first run is in the restored tab's folder.

### A type owns its options

A panel type is a module under `src/renderer/panels/types/`, and it declares its options in one place: name, kind (`text`, `path`, `duration`, `choice` or `list`), for a `path` what it resolves against and what it must point at, for a `duration` the shortest and longest it may be, for a `choice` the values it may be, for a `list` the fields of its items, if they are objects, and which groups of options are exactly-one-of.
The layout sees only what it needs to draw and place an entry: the default icon, a default title from the options where they give one, whether the type is bare, and whether it is a built-in the layout must place once.

**The type checks its own options**, with one checker every type shares (`panels/options.ts`), driven by that declaration: a key it does not know, a missing or doubled exactly-one-of, a value that is not a string or is empty, and what a path points at — the last asked of the main process, which has the filesystem.
A `list` is checked by the same function, item by item and field by field, each under its whole path (`actions[0].button`), so an item's field is held to exactly what an option of its kind is held to, and every item's mistakes are named, not only the first.
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
It runs when first shown, on Refresh, and when its context changes, which a tab switch, a project switch and stopping the tab you are on all do, and so does the tab's own session changing under it, on a `/clear` or a move into another folder, hidden or not once it has run (see A layout change keeps panels running).
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
Without it, the panel runs in the context directory: the folder the active tab's session works in ([§ Reading sessions](sessions.md#reading-sessions)), or the checkout picked for that session (below), else the selected project's root (`whereOf` and `resolveContext` in `panels/run.ts`).
An absolute or `~/` value is FIXED: that folder whatever is selected, so it runs with no project at all.
A relative value is under the context directory, so `"cwd": "packages/api"` follows the project into its subfolder — and a worktree session's panel into the worktree's copy.
The folder the run uses is the one main's check resolved, so the run goes exactly where the check looked, and `CLAUDE_UI_CWD` names it; the project and session variables are the selection at the moment of the run, empty when there is none.

**A panel names the folder it looks in, beside its title**, always, not only once it has followed a session elsewhere: in the badge a session row's worktree mark wears (`badge.css`), muted with the project's folder name for the main checkout, in the accent with the worktree mark and the worktree's name for a worktree, with the whole path its run goes to in its tooltip (`folderOf` in `panels/run.ts`, handed to the header through `setFolder`).
Only a panel the selection places names one: one with a fixed `cwd` does not, since nothing moves it, nor one that cannot run, nor a terminal, whose shells each name their folder in their tab's tooltip.
The app says it rather than each type, since where a panel looks is the app's decision: a note a type prints, or a heading it sets, was weighed and left, since only the types that print one would say it, and a type you were sent could name a folder it is not in.
It names the folder and not the branch, which the window cannot know without asking git.
The count keeps its place at the end, before the controls, and the mark gives way first when the header is narrow.

**A checkout picked from the session's worktree list holds the panels there while the session is on show** (`AppState.picks`, read through `pickedFor` in `state/picks.ts`), whatever the session goes on to change: an entry of the list its worktree badge opens, or of Worktrees in its menu, points them at that checkout, and "Follow the session", first in the same list, lets go.
The list opens with a line saying so, since nothing else in a session's menu moves the panels.
The pick is the session's, not its tab's (decided 2026-10-27), so the list is the same and does the same on every surface it is on, a tab or none, which is what lets a surface be left out of a layout one day; kept in memory only.
So closing a tab leaves its session's pick, and a `/clear` or claude's own `/resume`, which put another session in the tab, leave the panels following that session.
While the checkout picked is gone or no longer in the session's list, the panels follow the session, and the list ticks "Follow the session", the two read from the one rule.
Picking from a panel's own header was weighed and left: it reads as that panel's alone, while every panel without a folder of its own moves; so was a pick that only the tab's menu makes, the row's list being read-only, since the session's menu is to be the same on every surface.
The header's folder mark says a pick holds with the star a pinned session wears (`PINNED_BADGE_ICON`), and its tooltip says how to let go.
Letting go at the session's next change elsewhere was weighed and left: the panels would move while you read them.
The session's badge does not follow a pick, which is where you look and not what the session did, so while one holds the header can name another checkout than the badge's tone says.

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

Plain shells in a panel: the interactive login shell a session runs `claude` in, with nothing to run, each in a pty and an xterm of its own, as tabs in the panel's header.
Its options are `cwd` (see Where a panel runs) and `scope` (below).

**A shell stays put.**
A shell starts where the panel is placed at the moment it is made — the context directory, or its `cwd` — and stays there through tab and project switches.
A shell has state — the command you have running in it — so following the context the way the `command` panel does would kill that command on every switch.
So `+` after the tabs makes another shell where you are working now, Restart here in a tab's menu starts that tab's shell again there, and a tab's tooltip names its folder.
For a shell filed under a project, "there" is within that project: the selection where it is in that project, else the project's root (`ownWhere`), with the `cwd` option applied either way, so Restart here in All with another project's tab on show, or none, no longer starts a shell in the folder of a project it is not filed under; a fixed `cwd` still starts it in that folder (2026-10-16).
A shell's start is checked against the same project, so a restart's check and its start look at the same place unless the selection changes between them.
What that check finds wrong in a project other than the selection does not mark the panel as unable to run, as the selection's problems do, since that draws the problems in the panel's place and would hide every shell for one project's lack.
A start says so on that shell's screen, as a start main refuses does, and Restart here, checked before anything ends, leaves the shell running; either says so in the header too, with the rail's red dot, which are the panel's own and stay until another shell starts.
While the panel cannot run for the selection, no shell starts, another project's included, since it would run behind the problems where nobody sees it.
A tab is named after its folder, numbered from 2 when another of its project's has that name, and renamed with the app's name dialog, from its menu or a double-click, as a project or a group is.
A panel whose folder is missing says so in its place, like any panel that cannot run, and looks again whenever where you are may have changed (the project, the tab on show, or anything about the open tabs), whenever it comes back into view and whenever the config folder changes — with no button, being looked at is how a folder that has appeared since gets picked up.
Only the latest look at where you are says what the panel is, since main can answer an earlier one last, for a place you have since left.
Until 2026-10-17 a switch did not check the options again, so a panel that could not run in one project stayed so in the next until it was hidden and shown or the config folder changed, and one checked at launch, before the selection had arrived, said nothing in its place until you asked for a new shell.

**The shells are tabs inside the panel, not entries of its group.**
The tabs stand in the header where the title would be, so they cost no height, and the header grows only when they need more than one line: when they wrap, and in All, where each project has a row.
The header is the tree's, so the panel says what its tabs are through `PanelHost.setTabs`, as a list says its views through `setViews`, and the tree draws them (`panels/tabs.ts`) with the claude tab bar's own tab (`tab.ts`: its label, button, kebab, middle-click and drag), so the app has one tab, drawn in two places, and a later type gets tabs by saying them.
`setTabs(null)` puts the title back: with no tab the header is the ordinary one, and the line in the panel's body is the way in, since a header holding only a `+` read as something gone wrong (2026-10-16); the `+` comes with the first tab.
The rejected alternatives were the title with a `+` button at its right end, which put two "new terminal" buttons on screen at once, and the title with a `+` after it, a heading with an add button, which nothing else in the app has.
Each shell as an entry of the panel's group, switched from the rail, was the first plan, since a group's rail already switches panels, and was turned down before building: one glyph for every shell with its name only on hover, no place for `+` or a close, no rail at all in a group of one, two levels on one strip whose shown icon already folds the group, and every shell a panel the layout file does not name, which is still an open question for panels opened at will.
So the rail keeps one icon per panel, counting the tabs of the project on show, or in All every project's, folded away or not.

**By project.**
The `scope` option is `project` or `global`, the words planned for every type: `project` shows the selected project's shells, and in All every project's, a row each led by the project's name, which takes the session list to that project, in the project order you set, as the tab bar shows its tabs; `global` shows every shell everywhere.
It defaults to `project`, except with a fixed `cwd`, whose shells do not follow the project; a value in the file always wins.
A switch never ends a shell: the other projects' shells run on out of sight, which is cheap, since an idle login shell measured about 5.7 MB against about 437 MB for a claude session (2026-10-16, bash on Linux).
A shell's variables name its own project, whatever is selected when it starts, and the session on show only where that session is in that project (`runContext`): in All with one project's tab on show, a shell of another project started then is not that tab's (2026-10-16).
A shell filed under no project, as one made under `global` is, gets the selection, as a `command` panel does; one filed under a project gets that project whatever the scope says now.
The tab on show is remembered per project, and for All.
In All the rows fold to one, the row of the tab on show or the first with none on show, from the tab bar's own fold chevron laid on the header's bottom line, offered as the tab bar's is while there are two or more rows (`offerRowFold`), and the fold is kept with the shells; like the tab bar's fold, it bounds the rows, not the tabs.
The rejected alternatives for a tall header in All were a header capped at about two rows that scrolls, since tabs scrolling in a 28px header are fiddly to hit and nothing else in the app scrolls tabs, and one row without the projects' names, where tabs of different projects mix and look alike.
A project's name over its row does NOT mark a project whose folder is gone, as the tab bar's does ([§ A session whose folder is gone](terminal.md#a-session-whose-folder-is-gone)), deliberately: a shell there says so itself when it starts.

**Only you make a shell.**
Showing the panel or switching project makes no tab; where there is none, a line says so, with New terminal, and a key on that line makes one, as a key does in a shell that has exited.
With nowhere to start one, such as All with no session tab on show, whose project a new shell would be filed under, the line says to pick a project instead, and `+` says the same.
It first made one by itself wherever there was none (2026-10-16), which filled All with a shell for every project you had looked at, and was taken back the same day.
The tab on show still starts its shell when it comes into view, so a tab brought back from the last launch runs again when its project is shown: that never adds a tab.
A shell started by a press of yours — `+`, its tab picked, Restart here, or the close that put its tab on show — takes the keys once it has started, if its tab is still on show; one started because the panel came into view, the project changed or the app launched does not, so it never takes the keys from wherever you are typing.

**Kept for the next launch.**
The shells are kept in the panel's own file, `panel-data/<entry id>.json`, beside a list panel's sessions (§ Types from the config folder): each tab's id, name, project and folder, in order, the tab on show per project, and the fold.
A tab comes back with no shell, which starts when it is shown, in the folder the shell was in when the app quit.
Main reads that folder at `before-quit`, before the sweep, from `/proc/<pid>/cwd` of each shell it was told the owner of when it started it (the panel's entry and the tab), since only main still has the shells by then, and a `cd` just before quitting would be lost to anything the window saved earlier.
The quit waits for that write at most as long as its cap for the terminals, the grace and half a second more ([§ Stopping a session is a request](terminal.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question)).
Where `/proc` does not exist, on macOS, for a shell that had already exited, and for a folder removed since, the tab keeps the folder it was made or last restarted in.
A save the window sent before it heard of the quit can reach main after it, so main keeps the quit's folders over any later write, and the window saves nothing once it knows it is quitting (`quitting.ts`, which the claude tabs read too).
A panel whose data main cannot hand over at all brings back no tabs and keeps none that run, rather than writing over what the file holds; a file that does not parse is kept beside itself, as any panel's is (§ Types from the config folder).
What was on screen is not kept: it would put whatever a shell printed on disk, tokens and environment dumps included, which is also why the log never records a panel's output.

**Closing asks while a command runs.**
A tab's cross, a middle-click on it and its menu's Close end an idle shell at once; while a command runs in it they ask first, naming the command, and Restart here asks the same way.
What runs is read at the press from main (`terminal:foreground`): node-pty's name for the terminal's foreground process, which is the shell's own file while nothing else runs, so main compares the two by their last part and answers null for the shell itself.
MEASURED 2026-10-16 with bash on Linux: an idle shell reports `/bin/bash`, a command its own name (`sleep`, `vi`, the first of a pipeline), npm its title with its arguments (`npm run lint src/main`), a node script node's full path, and a nested `bash` reads `bash`, so a nested shell of the shell's own name reads as nothing running.
On macOS node-pty reports the executable's own name, cut to 16 characters, so `npm run dev` would read as `node` there, and can report nothing at all, which reads as nothing running (from its source, not measured).
A command left in the background is not the foreground, so a shell running only that closes without asking.
It is read at the press rather than kept as a mark on the tab, which a short command would change as it came and went; the claude tab's two presses, stop and then close, were turned down for the same reason.
The question is the app's confirm dialog, which takes its caller's words (`confirmDanger` in `dialogs.ts`, with the delete's `confirmDelete` one caller) and opens on Cancel; it is asked once at a time, so a second close pressed while the first is being asked ends nothing.
The dialog keeps that rule for every caller too: a confirm asked while another confirm is up is answered no at once and asks nothing, since it would rewrite the one on screen and take its answer as its own — as a shell's close did, whose look at what runs came back while a session's stop was being asked.

**A shell that exits comes back on a key press.**
Its screen stays up with a dimmed line saying it exited and that any key starts a new shell, and the next key does, in its tab and its folder; the key is the ask, so it is not sent on to the new shell.
That is what VS Code's terminal does, and it was chosen over a button that appears only once the shell has gone, and over restarting on exit by itself, which would need a guard against a shell that dies at once — a broken rc file, say — starting again forever.
Its tab goes unfilled, as a tab with nothing behind it does.
The header says nothing of an exit, as it did with one shell (`exited N`), since several shells share one header; a start that fails still says so there, with the rail's red dot.

**The same pty path as a session.**
`terminal.ts` has one spawn for both — the terminals map, the data and exit routing, the stop escalation and the quit sweep — with the claude-specific argument building and the plain-shell start as two callers of it.
A panel's shell is therefore stopped and swept by the same escalation as a session, asked with `SIGHUP` where a session is asked with `SIGTERM`, since an interactive bash, zsh or dash ignores `SIGTERM` ([§ Stopping a session is a request](terminal.md#stopping-a-session-is-a-request-claude-may-answer-it-with-a-question)), and nothing about it is a second implementation of a process the app runs.
It gets the `CLAUDE_UI_*` context in its environment and `COLORTERM=truecolor` as a session does, and NOT `CLAUDE_UI=1`: a `claude` started by hand in it must not report as one of the app's sessions.

**One xterm, one router.**
The renderer's `terminal.ts` builds every xterm in the window (the font tokens, the neutral foreground, the canvas fallback, clickable links, what Ctrl+V does) and routes every terminal's output and exit to whichever sink bound its id, a tab or a panel.
The tab's claude-specific key handling — Ctrl+Enter and Shift+Enter as newline, Ctrl+Z refused, Ctrl+C twice to close — stays with the tab, handed to `createTerminal` rather than attached to the xterm, since xterm holds one key handler and a second would replace the shared one.

**Ctrl+V pastes under WSL, and only there.**
xterm sends Ctrl+V on as `^V`, and claude reads that as "paste an image": under WSL it looks for an image before it falls back to the text, through xclip or wl-paste where there is one and then `powershell.exe`, whose call took ten seconds the first time it was measured.
So under WSL every terminal hands Ctrl+V back to Chromium, whose own paste runs into xterm's textarea, and xterm sends it as one paste, bracketed where the program asked for that.
An image still reaches claude: a clipboard holding no text gives a paste with nothing in it (in the app under WSLg, as in the window's checks), which claude under WSL reads as an image paste, and Alt+V is its own image key there.
Elsewhere Ctrl+V goes on as before: on native Linux, handing it back would cost the image, since Ctrl+V is claude's only image key there and claude reads no image from an empty paste; on macOS, Ctrl+V is not the paste key, Cmd+V is, and claude keeps Ctrl+V, as in Terminal.app.
Whether this is WSL is claude's own rule, mirrored in main (`runsOnWsl`, src/main/platform.ts) and asked once at startup, so the window never takes the key where claude would not read an empty paste as an image.
Rejected: the same on every platform, for the image paste it costs; claude's tabs only, which would answer one key two ways with nothing to say why; and passing Ctrl+V to claude only while the clipboard holds an image, which needs a look at the clipboard's formats that claude's empty paste already makes unnecessary.

**Under WSL, a paste with no text may be files copied in Explorer.**
Such a copy reaches neither side of Linux's clipboard — Windows holds a file list, `wl-paste -l` lists nothing and X11 offers an empty text — so only `powershell.exe` can read it, and claude's own image check, which asks Windows only whether it holds an image, finds nothing.
So a paste from a key (Ctrl+V, Ctrl+Shift+V or Shift+Insert) that brings no text is held while main looks (`copiedFiles`, src/main/clipboard.ts): at `wl-paste -l` first, since a screenshot looks the same from Linux and an image listed there is left to claude, which reads a png, jpeg, gif, webp or bmp one from Linux without asking Windows, then at Windows' file list, each path mapped by `wslpath -u`.
The window pastes the paths with their shell-special characters behind a backslash, joined by spaces (`pastedPaths`), which a shell reads as typed and claude splits into paths, attaching each image file; with none, the empty paste goes on as it came.
Not quoted, since claude splits a paste only at a space before a `/` or a drive, which a quote in front of each path would hide.
A middle-click is left alone, since it pastes the selection rather than the clipboard, and without wl-clipboard nothing is asked, since telling a screenshot from a file copy would then put a `powershell.exe` call in front of every screenshot.
Asking Windows took 0.4 to 1 s warm when measured, and nothing shows meanwhile.
Rejected: Windows paths, as Explorer's Copy as path gives them, which a panel's shell cannot use.
Each shell fits its xterm from a `ResizeObserver` on its own box rather than when it is made, because a shell is made before its box is on screen and the box measures nothing yet: the hidden-pane trap, in its "not yet placed" form.
The same observer covers every later reveal — its tab picked, a switch on the rail, an unfold, a divider reopening a squeezed node — since each gives the box a size again.

### Types from the config folder

A folder under `panel-types/` is a panel type of the person's own: a `panel.json` manifest and the script it runs.
The folder is `panel-types/` rather than `panels/` since each folder in it defines a TYPE, which the layout then uses for any number of panels, each with an id of its own; it was `types/` until 2026-10-14, renamed before any release read it, since `types/` beside `layouts/` and `scripts/` said too little.
It exists so a panel can be shared without being part of the app — the first one is a review queue fed by a task in another repo — and every choice below follows from that.
The contract itself, field by field, is `docs/panel-types.md`; this section is why it is shaped as it is.

**One list of fields per object, and the document is held to it.**
Each checker names the fields it reads in one list (`MANIFEST_FIELDS` and `OPTION_FIELDS` in `types/folder.ts`, `LIST_FIELDS` in `types/listdoc.ts`) and reads a field only through that list (`panels/fields.ts`), so a field it reads that the list lacks is a type error.
A test reads the document's tables and its lists of kinds and tones against the same lists, checks its marked examples with the checkers themselves, and holds its table of variables to what the runner sets: a field added on either side alone fails, the way the layout guide's icon list is held to the icon set.

**The folder's name is the type's name**, so the two cannot disagree, and a folder is shared by copying it.
A folder named like a built-in type, or with a name that cannot be a type's, is not read, and a note under the whole layout says so, since no single entry is where it went wrong.
Main reads the manifests in the same pass as the layout file and hands them over raw, as it does the layout, so the renderer resolves the layout knowing every type at once and never shows an entry as a type nobody has for the moment between two reads.

**The kind decides the rest.**
A manifest names what kind of panel it is, and the kind brings its own options and behaviour; `list` is the one kind so far.
So `cwd`, `interval` and `watch` are the list kind's own, not something every panel takes: a shell has nothing to re-run, so the `terminal` type takes `cwd` and a `scope` of its own, while the `command` type takes all three, as the same declarations.
A manifest is checked like the layout file — every mistake named, each prefixed with its file — and a type whose manifest is wrong is still a type, so every entry of it says what is wrong where the panel would be.
A field the manifest does not know is a note, not a mistake, and the same holds for the list a script prints: both are a contract a shared type is written against, with a `version`, so a field a later version added is ignored here and only a version bump is a break.
An edit to a manifest mounts that type's panels afresh: the type carries a revision, and the mount signature includes it beside the entry's options.
A manifest declares an option as a `text` or a `list`, a list's items being texts, or objects of the `fields` it declares, each field declared as an option is and checked by the one function that checks a manifest's options; a field is a `text` only, for now (2026-10-14), so no field is a list until that check allows one.
A list reaches the script as JSON in the same `CLAUDE_UI_OPTION_<NAME>` a text does, since a variable holds a string: exact for any character, and one parse in a script; a text stays as it is written, so nothing written for a text changed.
Numbered variables (`…_ACTIONS_0_BUTTON`) were weighed and turned down, since an option may already be named `actions_0_button`, and so was one file holding every option, a second channel to keep in step with the variables.

**The script describes and the app acts.**
A list script only prints; opening a row's link, or a link in its detail, is the app's, through the same route every link leaves by, which takes http and https only.
That is the decision the whole shape rests on (2026-09-29): a JavaScript module loaded into the window would hold the bridge to every session, and a sandboxed page would need a message API of its own for the same result, while a script that prints can do nothing beyond running unless the person presses something.
It is also why nothing a script prints is ever markup: every row is built as text.

**Stdout alone is the list.**
A list run asks the runner to keep stderr apart: the script's stdout and stderr go to two pipes of their own, and the login shell's own output is discarded, so nothing an rc file prints can land in front of the document (measured against the real shell).
The `command` type still merges the two, in arrival order, since it shows what was printed.
Stderr's end is kept as the reason a failure gives: mise, for one, writes the task line there on every run.

**When it runs.**
On first being shown, on Refresh, on a context change once it has run, shown or not, as a `command` panel does, and on its interval, all through the same piece (`PanelRuns`, § The `command` type); the interval also runs while the panel is hidden or folded: the count on its rail icon is the point of a queue, and a count that stops while you are not looking says something false.
The first run of a panel with an interval is when the tree goes live, shown or not.
A run may say when it runs next through its control file, as a `command` panel's may (§ The `command` type); what the file gets wrong sits on the note line beside the type's notes and the list's own.
`watch: git` runs it again when its working tree changes, as it does a `command` panel (§ The `command` type).
The interval is ten seconds to a day: at least ten seconds, so a typo cannot start a script every second, and at most a day, which also keeps every wait well inside what a timer holds — past 2^31 − 1 ms (about 25 days) a browser's `setTimeout` wraps the delay to a signed 32-bit value, which up to about 49 days turns negative and fires at once, and beyond fires after some shorter, wrong delay, so a longer interval ran at the wrong time, mostly at once, every time.

**The sessions it is given.**
Every run gets the sessions the app has, in a file named in `CLAUDE_UI_SESSIONS`, so a type can choose its rows from them; live values keep the rows it chose current between runs, without a run (decided 2026-11-02).
It is built per run by the window (`panels/snapshot.ts`), which alone holds every part of it together: the session list, statuses, read marks, needs-you and set-aside marks, groups and PR statuses.
Main writes it to a file made as the control file is, readable by the user alone, and removes it when the run ends; a crash, or a write that fails partway, leaves it behind with the rest of the temp folder.
One file main kept current was the alternative, rejected: main would need every change pushed to it and atomic writes, for a reader outside a run that nobody has.
It is data, never the app's words: a reason is its `reason`, `at` and PR changes, since the app's own lines (`needsYouLines`) open with "Needs you —", which is the tooltip's and wrong under a Needs you heading.
The fields are the ones a type needed, sorted by id so a new order is no change; pins, notes, worktrees and when a session was last active stay out until a type asks, the last above all, since it changes on every message.
A status is what the session's claude last reported, filtered to the ones the docs name, and null rather than guessed for a session with no report, never having sent one or its report forgotten when its claude went.
On this machine's scale, about 550 sessions not finished, a snapshot of that shape measured about 200 KB and under a millisecond to serialise (synthetic sessions, 2026-11-02), so every list run gets it rather than only a type that asks; asking first comes if that stops being small.
Its shape is the one the `page` kind's API would serve.

**`watch: sessions` runs it again when the snapshot changes.**
The list kind's `watch` takes it beside `git` (`LIST_WATCH_OPTION`); a `command` panel is given no snapshot, so its `watch` does not.
`PanelRuns` hears of every change to the slices the snapshot is made of (`SNAPSHOT_SLICES`, through the host's `watchSessions`), and once none has come for 2 seconds builds the snapshot and compares it with the one the latest run was given: a difference runs the panel, unasked and out of sight too, as a change in a watched tree does.
Not before the panel has run, nor while a run goes, whose end looks again, nor for a panel that cannot run; a run that found nowhere to run does not look again, since its snapshot would differ every time and run it in a loop, so a change during its check waits for the next one.
A fixed poll, as git's 30 seconds, was too slow for a session waiting for you; 2 seconds is the moment of one turn's end, its status and its read mark landing together.

**Never an empty list for a broken run.**
A run that fails, or prints something that is not a list, says so.
With a good list already there, the list stays under a line saying when the run failed and why, and that list's count stays beside it; without one the panel says it is unavailable, quoting stderr's last lines.
An empty queue and a broken one otherwise look the same, and one of them is a lie; blanking the list on every failure was the other way, and a bad minute on the network would blank it every time.
Before the first run has ended it says it is waiting, which is neither state.

**What it looks like is the app's.**
That is the default rather than a limit: a type is to be able to overrule it in a later version, and until then it chooses from the words the contract offers, such as a row's `tone`.
A row is the card a session row is, and a section heading the sidebar's group bar, built by the same builders (`card.ts`) and drawn by the same rules rather than restyled; a row's tone is the status colours on its leading edge, where a session row keeps its accent bar for "open in a tab".
A row's first line can carry a lead before its text and a trail after it, which the text gives way to; a lead is coloured by a tone of its own, from the same words and the same one map of tone to colour (`tone.css`) as the row's edge, so a mark on a row never grows a palette of its own, and it never takes its row's tone, which would put a coloured edge on every row whose mark is coloured.
A row's `detail` is lines of parts rather than a string, so that a part can be a link of its own, and so that the separator between parts is the app's to draw rather than characters inside the script's text.
The list names the separator once, ` · ` without one, and a row may name its own, which a row it holds does not take, so a list says it once for every level.
There is no string form beside it: panel types had not shipped when it changed (2026-10-14), so nothing written for the string had to keep working, and a second way to write the line would have been the one that puts the separator back in the text.
Among the other ways weighed were a `links` field drawn after `detail`, which kept the separators in the text and put links at the end of the line only, markup inside `detail`, which nothing here ever draws, and a line break written as `\n` in a string, which leaves the lines implicit.
A part's tone comes from the same map as a lead's, and its colour never reads its row's: only a part whose own tone has a colour sets one, which otherwise leaves a link its accent.
A link in a detail line is an `<a>` sent to the browser by the helper the history's links use (`routeLinks`, `external-links.ts`), and the row's own click leaves a press on it alone; a part with another verb is an `<a>` without a link, which `list.css` gives a link's underline and pointer, since the browser's own link rule reaches only an `<a>` with one, whose press wins over the row's as a link's does.
Hovering a link shows only what the type says: until 2026-10-30 the app always added where it goes, since a shared type's links were taken to be somebody else's, but whether a row shows that is the type's choice now, as everything a press does is (below).
Each line, and each part and separator in it, is kept by its place (`keyed.ts`), and a part by whether it links, has another press or neither, so a press on a part survives a run that changes what the line says.
A row can hold rows (`children`), drawn after it a step further in, as siblings in its section rather than inside it, so a row stays the same element by its key wherever it sits, and a run that changes only its level, leaving its place among the section's rows, does not lose a press on it; it folds them from a chevron, or from a press anywhere on it when it has no press of its own, and its folds are kept by key, in memory, while the panel stays mounted, as a section's are by title.
A section's count counts the rows that hold none, since a row holding rows only groups them.
A list can name `views`, the ways its script prints it, and with two or more the panel's header draws a switch between them beside Refresh: the first header control besides the one button that a type asks the tree to draw (`PanelHost.setViews`), as it draws the count, so a type that is not bare still builds no header chrome of its own.
A pick is the panel's as a group's picked panel is the group's: a layout entry's `view` is what it shows without one, read as the layout says it now rather than as it was when the panel mounted, since an edit of `view` alone does not mount it afresh; the app's file beside the layout keeps a pick only where it differs from that, or from the first view when the entry names none; the script is given the view on show as `CLAUDE_UI_VIEW` and a pick runs it again.
An entry naming a view its list does not offer is said in the group's note line, which only the list's views can tell, so the layout's own check looks at the shape alone.
The switch marks what is on show as a rail marks its panel, filled at rest, takes no pointer or hover on it since a press there does nothing, and is drawn again only when what it says changes, so a press on it survives a run offering the same views.
The count on a rail icon sits inside the button, under the icon on a vertical rail and beside it on a horizontal one: a corner badge was tried first, and at 3x even "9+" covered the whole icon on a 24px button, while the rail clips anything past its 28px.
The icon's tooltip and label say the count whole.

**What a press does is the type's, from one vocabulary of verbs.**
An action's button, a press on a row and a press on a part each name a verb: `session`, `open-session`, `open-url` or `copy` (decided 2026-10-30), and every press but a part's link ends in one place (`perform`), so a verb does the same wherever it is pressed; a part's `open-url` is an `<a>` with its link, which the list's link route opens (`routeLinks`), into the same browser.
A verb is a description the app carries out, so the script still only prints; a type decides what its rows do, which before this the app had decided for it (a row opened its link, a button asked for a session).
A row's or a part's `href` was dropped for `open-url` (decided 2026-10-30): panel types had not been released, and two ways to say one thing is what one behaviour per thing warns against; keeping it as a short form was the alternative, rejected for that reason.
A list still writing one draws, since an unknown field is ignored, without its links; a row without a press still folds its children.
A verb this build does not have leaves an action out and a press as none, as an unknown field is ignored, so a later build's script still draws; two verbs this build has on one object are a mistake, since which one happens would be a guess.
`copy` goes through the same helper as every copy in the app (`copyText`), its toast once copied in the type's words when it gives some and "Copied." otherwise, and never empty, since a copy that says nothing is the one that seems to do nothing, so copying behaves the same everywhere while the words are the type's.
`open-session` goes to the session (`openSession`), switching project when it has to; an id the app has no session for says so in a toast rather than doing nothing.

**A row can ask for a session, and only ask.**
A `session` action is a button on the row, or an item of its menu, or a press; pressing it hands the app a request (the item, the prompt, the name, the folder the panel last ran in), and the app opens its own dialog on it: the project, the group, the name and the first prompt, all changeable, and nothing starts before Start.
A row shows its first actions as buttons, as many as the list's `buttons` says, 1 without one, and the rest in a menu behind the app's own kebab, last on the row, as a session row's kebab is (2026-10-14).
Two buttons already took about half of a story row in the 360px column it was seen in, which replaced the rule first planned, one or two as buttons and a kebab only past that (2026-10-08); and the list says how many, which that rule had turned down so that two lists could not make one row look different, since a type may want its rows otherwise; a row does not say it for itself yet.
The kebab lists its items afresh at each press from the row as the last good run left it, and an item does its action only if the row still offers it when chosen, by all it says, as a button is kept by all it says, so a menu left open across a run never asks for an action the run took away.
That dialog is the trust line for a shared type: a prompt runs with the person's permissions, so what a panel from anyone asks claude to do is always read first.
The projects offered are the switcher's, in its order and without those whose folder is gone; the one the panel's folder is in comes first, found as the deepest project that folder sits under (`projectFor`), and the folder itself is offered when it is in no project yet.
The group comes first as the one last picked from that panel in that project, while it still exists; making one is left to the session list, since the app never makes a group nobody asked for.
Start goes down the same path as any new session (`openNewSession`), with the name as `--name` and the prompt as claude's positional first prompt — placed LAST, after `--` and after the user's own flags, since a flag taking several values swallows a prompt after it and a prompt starting with `-` reads as a flag (both measured against claude before this was built).

**A row leads back to its sessions.**
The row asks its host for the sessions its item started that the app still has, latest first, and draws the latest's status dot with the session list's own classes, a count beside it when there are several.
A press goes to the session — its project, its tab, its row — since the session is often in another project than the one on screen; with several, the app's menu offers them, each led by its own dot as the mark draws it, since a menu item that is a session takes a session's dot rather than a roll-up's.
The marks are repainted IN PLACE whenever the renderer repaints sessions itself (the switcher's roll-ups, the tab bar, the list), batched to once a task, so a status event never rebuilds the list under the pointer.
A link whose session the app no longer has is simply not drawn, whether or not main has forgotten it yet.
A second Review on such a row opens the dialog on CONTINUING the latest session, since that session holds what the first look found: stopped, it is resumed with the prompt as its first (`--resume <id> -- <prompt>`, checked against claude in print mode before this was built); running, it is brought into view and the prompt is not sent, which the dialog says before anything happens, because typing into a live session could land mid-turn or on a question and is never the app's to do.

**Which session a row started is the panel's data, kept by the app.**
One file per entry, `panel-data/<entry id>.json` in the app's data directory, with the sessions its rows started (by session id: the item's key, its text, its link, when) and the group last picked per project; a `terminal` panel keeps its shells in it too (§ The `terminal` type).
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
