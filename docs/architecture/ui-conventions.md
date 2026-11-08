# UI conventions

## UI conventions

Vocabulary, in code and in the UI: a **folder** is a literal directory path; a **project** is the grouping a session belongs to, keyed by its repo root, which merges a repo's worktrees and subdirectories into one entry; a **group** is a user-made sub-section inside a project.
A **panel group** is the layout's node of panels and unrelated to either, so the layout always says "panel group" in words meant for people.
The three are not interchangeable — one project spans several folders, which is why the switcher, the session list and the tab bar all say "project".

**The project scope holds everywhere.**
Selecting a project in the switcher is a statement about what you are looking at, so every surface honours it — the list, the tab bar, the placeholder's wording, and the finished view, which used to be exempt and no longer is.
Switch to All to search or browse across projects; that is what All is for.

**The empty terminal pane names the next action**, and it has four to choose from: no sessions at all, sessions but no tabs in this project, tabs but none selected, and a selected tab that isn't running.
One sentence cannot cover them — it ends up telling someone with no tabs to pick a tab.
Note it counts the tabs actually on screen (`visibleTabs()`, the same helper the bar renders from), not every open tab.

Any control that opens a menu or popover keeps its active look (the same look it shows on hover) for as long as the menu is open, including when the pointer moves off it.
The shared `openMenu` helper stamps `.menu-open` on the trigger while its menu is up, and an icon button takes its open look from the same rule as its hover (`.icon-btn…:is(:hover, .menu-open)` in `base.css`, one for each kind), so the kebabs, the group jump, the carets and a list row's session mark need nothing of their own.
A trigger that is not an `.icon-btn`, such as the sibling badge, or that sets a hover of its own, such as the project heading's split button, names `.menu-open` beside its `:hover` in that rule.
The open rules used to be written per trigger, five of them in step by hand, and the one trigger nobody remembered, a list row's session mark, showed nothing at all while its menu was up.
A row holding the trigger keeps its own hover look too, the card by `:has(.menu-open)` beside its `:hover` in `card.css`, and a tab by the same in `tab-bar.css`.

Every menu/popover also reads as attached to its trigger: `openMenu`/`openSubmenu` add an `attach-top`/`attach-bottom`/`attach-right`/`attach-left` class and set `--notch-x`/`--notch-y`, which position a small notch on the menu's edge pointing at the trigger's center.
Anything new that floats near an anchor should go through those helpers so it gets the notch (and the active-state stamping) for free rather than reinventing positioning.
The notch straddles the edge, so its inner half lies over the row beside that edge, the first one for a popover below its trigger, and it is drawn beneath the popover's content (`z-index: -1` inside the popover's own stacking context): drawn on top, it bit a notch-shaped piece out of any row with a fill of its own under it, a hovered item, the switcher's entry on show, or a row scrolled up under it.

**An open kebab menu follows what it lists.**
Every kebab, and a tab's right-click, which opens the tab's kebab menu, hands `openMenu` the builder of its items, and while the menu is up every change to the store lists them again; where they differ from what it shows, it is drawn again and placed again under its trigger.
So a menu left open does not go on offering what can no longer be done, such as Force stop for a session claude has since left (decided 2026-10-21).
Only where they differ, compared by all an item shows, since a redraw replaces every row under the pointer; a change that leaves everything the menu shows as it was leaves it as it is drawn.
That includes the relative times a session's menu shows, its last activity and its siblings', which move with the clock rather than the store, so the first change to the store after one of them ticks over draws the menu again.
An open submenu goes with the row it hangs from, and is opened again under the row drawn in its place while an available item with the same label still has one, so it stays under the pointer wherever that row is drawn where it was; a parent whose label changed, such as Siblings with a new count, is another item, and its submenu stays closed.
A menu whose items are gone, or whose trigger has left the page, closes at the next change to the store, which is the same moment for a trigger the store's own repaint removed.
It was a snapshot before, built at the click and kept until it closed.
The other menus, the sibling and PR lists opened from a row's badges, the group jump, the new-session caret and a list row's sessions, are drawn once, as before.
A list panel's rows are not in the store, so its kebab follows a run only at the next change to the store after it; its items ask for their action only while the row still offers them, so the lag shows a stale item, never runs one.

**One appearance, one rule.**
Anything drawn on more than one surface is a single class, never parallel rules kept in step by hand.
Parallel rules always drift, and they drift silently: the session mark and the strip mark were the same dot in two classes, and they diverged twice — first to two different sizes, worst on the busy arc, where 7px and 9px read as two different marks rather than one state; then to a hollow ring in the list and a 9px hole in the strip for a session that had not reported yet.
They are now one `.nudge`, with `.nudge.clickable` for a session's own dot while it is a control rather than a report.
A state's colour, mark and pulse are in no stylesheet of the app's: they are its look ([§ Status cues](status-cues.md#status-cues)), written into the page as one stylesheet (`looks.ts`), a rule per look on its class, `look-<id>`, which every dot carries beside its state's (`statusdot.ts`), so a look reaches every surface without any of them building anything for it.
That stylesheet goes first in the page, so `.nudge`'s own rules, such as read's dimming, win over a look at the same weight, and the ring of a session with nothing to report (`.single`) takes one class's weight so a look draws over it.
Its class was chosen over a `data-` attribute because the dots of a menu or a header travel as class strings.
The practical test: **a comment saying "match X exactly", or "same as Y", is a bug report against the stylesheet.**
It means the relationship is being maintained by whoever remembers it.
Extract the shared rule and let the difference be a modifier.
When a variant genuinely differs — a group heading is deliberately lighter than a project heading — that is a modifier on the shared base, not a second copy of it.

**A surface drawn again while it is used keeps its elements.**
A click is a press and a release on the same element, so a surface that takes the pressed element away between the two produces no click at all, and one that takes out the focused element drops the focus to the page.
The surfaces that keep their elements are drawn again on events nobody times — the session list when a transcript is written or a model switched, the project switcher whenever a session's status changes, the tab bar whenever one of its tabs' sessions' does, a list panel on each run that prints a list and its rows' session marks whenever one of their sessions changes — so that press is an everyday one rather than a race.
So a surface keeps its elements by key and leaves in place what already is, through one helper, `keyed.ts`: `Keyed` holds the elements, built the first time a render draws a key and swept once one no longer does, and `placeChildren` puts them in order, keeping the longest run already in order where it is, so only what really moved is taken out.
Keeping them is not enough on its own: in Chromium, `appendChild`, `insertBefore` and `replaceChildren` take out even an element already where it belongs, which is how the session list, which had always kept its rows, still lost both.
The same goes for an icon inside a kept element: setting its markup again replaces the icon's own element, which sits over the middle of an icon button where a press lands, so an icon a render sets is set through `setMarkup`, which leaves the same markup alone.
A kept element outlives what it was built for, so its handlers look up what they act on by its key when they run, as a session row's read `currentByKey`, never what was current when it was built.
A library bound to a kept element lives as long as the element, and `Keyed`'s `forget` lets it go when the element is swept, as the tab bar's rows destroy their Sortable.
They do it through `dropSortable` (`tab.ts`), which waits for a drag under way to end, since destroying a Sortable during a drag, even another row's or another surface's, ends that drag inside the library without its `end` reaching anyone (sortablejs 1.15.7), which left the dragged tab marked and its owner holding its draws for good.
While such a library moves the elements itself, the surface does not draw: during a tab drag, Sortable moves the dragged tab and puts its copy of it in the row, so the tab bar holds a draw asked for meanwhile and makes it once the tab drops, rather than undoing the drag under the pointer.

**A time that says how long ago is drawn on a clock, not by its surface.**
"5 min ago" goes out of date while nothing in the store moves, so a surface that draws only when the store tells it, or never again, as the history keeps each exchange it has drawn, leaves it frozen; the session list's rows did, until something else redrew the list.
So such an element is handed to `showMoment` (`moments.ts`) with its words and its moment, and drawn again every minute while it is in the page, a minute being the finest step `relativeTime` takes past "just now": a session row's time, the finished view's, and an exchange's in the history.
What it says is asked for again at each tick rather than kept: a row asks of the newest listing, which the store keeps even when its equality told nobody ([§ The store](processes.md#the-store)), so a session claude is writing to moves its row's time without the list redrawing for it, and `AFFECTS_ROW.lastActivity` stays `false`.
Each carries its moment in full as its tooltip where the moment is known, in one format, `toLocaleString`.
Rounding the time into the list's signature was weighed and turned down: it moves a row whose last activity moves, but a quiet row's never does, and those are the rows it matters for; so was redrawing the whole list every minute, which reconciles every section and brings every drawn row up to date for one line of text, and reaches no other surface.
A copy of a tick took 1–2 ms over 519 rows in headless Chromium, about 45 of them changing (2026-10-22); the app itself was not measured.
A menu is written when it opens and is not on the clock, so an open kebab menu's times follow the store, as said above of an open kebab menu.

**The session list's order catches up on the same clock, and never under the pointer.**
The list orders a section's rows, and the review its sets' rows, by last activity, which on its own tells the list nothing, for the reason above; so the order used to be the one of the list's last draw, and moved at the next draw for any other reason, a pin or a new session, under the pointer as likely as not.
Now each minute's tick (`onMinute`, `moments.ts`) compares the keys the list would draw now, from the one function every draw takes them from (`listShape`, `sessions/list.ts`), with the keys of the rows the last draw left on screen, and draws the list again where they differ (decided 2026-11-04).
It holds while the pointer is over the list, the focus is in it, or a menu opened from it is up, found by the mark its trigger wears (`.menu-open`), since the menu sits on the page's body; the next tick tries again, so nothing waits on the pointer leaving.
The same look covers an open review, which gains or loses a session as it crosses its days.
A draw at every change of the order was weighed and turned down: over a week of this machine's transcripts (2026-11-04), a simulated flat list of every session by last activity would have moved a row about 67 times an hour of work in All, nearly all of them sessions in the top five trading places as each running one wrote in turn, the reason a list read while working does not follow recency (§ Traps worth knowing); checked once a minute, the order had moved in about 13 minutes of each such hour in All.
Ordering by the last prompt you sent was turned down too, since a row's time says claude's last write, and the order and the time would disagree.

**A module's stylesheet sits beside it, and the module imports it.**
esbuild bundles every stylesheet a module imports into one `renderer.css`, in import order, each file once, so `index.html` links only that: `xterm.css` and `air-datepicker.css` are imports of the modules that use them too.
A rule sits beside the one module that draws it; a rule several modules draw sits in a stylesheet of its own beside what owns it — the menu row in `menu-row.css`, the surface and notch every menu and popover floats on in `popover.css`, a dialog's or the pane's decisive button (`.primary`, `.danger`) in `decisive-button.css`, the filter pill in `pill.css`, the card and the section heading in `card.css`, the badge pill a session row's marks and a panel's folder wear in `badge.css`, the calendar the filter's date range and Pick a date… both draw, its palette and its weeks from the language's first day ([§ The language](window.md#the-language)), in `calendar.ts` and `calendar.css` (decided 2026-10-29) — or in `base.css` when nothing does (the tokens, the reset, `.icon-btn`, `.pair-end`, `.nudge`, the empty pane's sentence), and is never copied into each.
A stylesheet takes its place in the bundle where it is first imported, so `renderer.ts` imports `base.css` and the services first, ahead of every panel, and a rule that has to beat another of equal specificity sits after it in the same file.
Moving a rule between files can change which of two such rules wins without anything in the CSS's own diff showing it, so a move is checked with the style capture ([§ The window's checks](build-and-checks.md#the-windows-checks)).
Moving an import can do the same, and the capture runs only when asked, so the order the stylesheets come in is pinned by a unit test (`test/unit/renderer/renderer.test.ts`): an import that moves a stylesheet fails it until the capture has been run before and after and the list updated.

**The tab bar's names are jumps into the list.**
A project's name scrolls the session list to that project and a group's to that group, and each flashes the heading it lands on: two labels at two levels doing the same thing, drawn from one shape and one hover rule.
The group's is the function behind the heading's jump menu (`revealGroup`), and the project's (`revealProject`) flashes through the same `flash()`.
The flash has no end keyframe, so it fades into whatever the element already has — a project heading's `--bg`, a group heading's `--surface`, an open row's accent bar.
It used to end on `--surface`, which is right only for a group heading, and on anything else it finished by snapping to the element's own colour; that went unnoticed until a project heading was flashed.

**The tab bar folds to one row, the row of the tab on show**, to give the terminal the room the bar takes even when it is behaving.
That row is a cluster the bar already draws — a project's ungrouped tabs, or one group's — so folding needs no grouping of its own, and the tab on show is the signal the bar and the list already mark it by.
With no tab on show it keeps the first row that holds a tab, so the pane's "Pick a tab above" always has one above it; the bar's first row would not do, since in All that can be a project's name alone, its tabs all in groups.
In All a group's row says nothing of its project, so as the folded bar's one row it carries its project's name in front, the same jump as the project's own row.
It bounds the rows, not the tabs: a project with twenty ungrouped tabs still wraps that one row onto several lines.
It folds from the chevron a panel group folds from ([§ Dividers and folding](panels.md#dividers-and-folding)), laid on a line under the bar that the tabs sit on, a divider's hairline with a divider's 5px to point at, and centred along it; the chevron points up while the bar is open, the way its edge moves as it folds.
It was first a button at the right end of the bar's top row, which is the variant the divider's chevron had already beaten in the layout's mock, a button in the panel's own bar; it also took a column of width from every row, and in All sat beside a row that can be a project's name alone, out of line with the tabs.
The line goes with the bar's last tab, and the chevron is there only while the open bar has two or more rows, since one row has nothing to fold (`offerRowFold` in `fold-chevron.ts`, which a panel's tabs use too).
Folded is a stance all the same, kept unseen on one row, so a second row comes up folded, with the chevron to open it.
The chevron first stayed on a bar of one row, where a press on it changed none of the tabs or rows, only the chevron itself, and was taken off it (2026-10-16); unfolding whenever the bar dropped to one row was turned down, since a fold chosen in All would then be lost on every switch to a project with one row.
While a tab the fold hides asks something of you — waiting, or finished and not marked read, by the test the switcher's badge counts with (`asksForYou`) — the chevron turns into that tab's status dot, the strongest of them, in the arrow's place and at full strength; pointing at the line, or the keyboard's focus on the chevron, turns it back into the arrow, so it says what it does before it is pressed.
A tab at work asks nothing, so it leaves the chevron be: with a few sessions working out of sight, a chevron that turned for them would hardly ever be a chevron.
The dot first sat on the chevron's corner, as a rail icon's does, for every status busy included; it took the chevron's resting fade, and a busy ring at that strength on the corner of an 11px tab read badly.
A dot on the line beside the chevron, and a dot per hidden tab at the end of the row, were weighed against turning the chevron itself: the first would need a click of its own and could read as a second control, and the second could wrap the folded bar onto a second line, while the session list already says which session it is.
The fold is one state for the whole bar, the same in every project and in All, and kept for the next launch beside the sidebar's view ([§ Reopening the way you left it](window.md#reopening-the-way-you-left-it)).
It is not in the layout's `.local.json`, where a group's fold is: that would be a field the layout file could carry too, for a starting state that matters only on a first run, and the layout would learn a concept of the panel's.

**A setting is named for what it turns on.**
Its key and its label say what happens when it is on, never what stops: a key such as `resumeSessions`, not `disableResume`, and never a `no…`, `disable…` or `hide…`.
So on always reads as yes, and nobody has to undo a negative to know what a box does.
Something the app does unless you say otherwise is therefore a setting that defaults to on, not an opt-out named for turning it off.
In Settings, an on/off is a switch beside the words for what it turns on (decided 2026-11-08, replacing the plain checkbox, as the mocks drew it): the native checkbox drawn as one (`.settings-switch`) and carrying `role="switch"`, so it keeps the keyboard and says on or off as one, in the row the session dialog's radios use (`.dialog-choice`); a setting's, such as `prStatus`, "PR status from GitHub", sits under its group's label and detail like any other setting (`.dialog-group`), and Only what differs, which sets nothing, at the foot of the list of sections.
A setting with more than two choices names each for what it does, and so does one of two choices that are both acts: `runningSessionsAtLaunch` is `start` or `cold`, and neither is a `no…`.
So is a choice between acts rather than an act and its absence, a dropdown rather than a box: `leaveButton` is `stop-close`, `stop-finish`, `close`, `finish` or `none`, `none` being a button that is not there rather than an act turned off.
It is one setting rather than two dependent ones, a stopped tab's button and a running tab's, which would allow a combination that means nothing, such as no button with a one-press close.

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

**A session row's trailing controls sit 4px apart** — its pin and kebab, or its Unfinished button, delete and kebab in the finished view — so the pins line up down the list, not just the kebabs.
Tight rather than roomy because every pixel there is width the session title loses; the controls' own padding keeps their ink well clear.
The row's gap is 8, so one rule, `.pair-end` in `base.css`, works the offset out from the row's own `--row-gap`.
A heading's kebab sits 8px after its new-session button instead, since that button wears a border and the kebab's narrow dots crowded it at 4px, so on a group heading the split button's right edge sits 4px left of the pins below it, where it lined up with them (`headings.css`).
On a tab the kebab sits right against the tab's button, the two one pair at the row's end (`.abuts`, from the row's `--row-gap` too).

**Hover** is one rule for each kind of icon control.
A borderless one — a kebab, the pin, a close or a stop, a row's Unfinished and delete, the group jump — turns its glyph `--accent` and nothing else.
It used to fill and outline as well, which needs a box around the glyph; once a kebab's box hugged its dots, that box ran into the title and the button beside it, and without it controls can sit as close as their marks allow.
Accent rather than `--text`, which was tried first: `--text` is the same greyish blue as the resting `--muted`, only lighter, where accent is a saturated blue; the accent here is the same "you can press this" as a framed button's accent outline, not the live-session accent of a row's bar or a tab's edge.
A rail's icon and a panel's view in its header's switch are left out of that: the one on show among them, where one is, is marked with `--active` and a `--text` glyph, and on the rail a blue edge, so one not on show takes a live tab's hover fill, `--surface-hover`, with its glyph turning from `--muted` to `--text`, and no outline.
The one on show keeps its look under the pointer, as the active tab does; where a press on it folds its group, the pointer says so, and where it does nothing, the cursor stays the arrow.
Their glyph never turns blue: under the borderless accent hover it turned blue under the pointer, and a view's went white once shown, which read as the hover being undone, and a hover of the glyph alone had made hover a coloured mark and on show a filled box, two looks rather than two steps of one.
A framed one, with a resting border — the split buttons' halves (`.composite`) and the divider's fold chevron (`.framed`) — fills `--active` with an accent border and a `--text` glyph, its border already saying where it is.
It uses `--active` rather than `--surface-hover` because a hovered session row is already `--surface-hover`, so a button filling to the same colour inside it would show no change; the project heading's `+`, on a filled bar, keeps a fill of its own (`headings.css`).
The header actions (`.large`) wear a resting border too, but they stand beside + New as its peers, in the ordinary button's skin, so they take the ordinary button's hover, `--surface-hover` with an accent border, and the four hover alike.
That leaves `--active`, a stronger, blue-tinted step from the resting fill, to say what a sidebar button opened is up, the filter's panel, + New's folder picker or the Settings dialog, and it outranks the hover, so the filter's holds under the pointer (the Settings dialog's overlay covers its button while it is up): the ladder a live tab and the switcher's title climb too, `--surface-hover` on hover and `--active` for what is open or on show.
While the header actions hovered to `--active` as well, the filter looked the same hovered and open, and + New, a plain button, hovered to `--surface-hover` beside them and turned, while its picker was open, the `--active` they hovered to.
The app-wide `button:hover` fill and accent border leave every other icon button alone, which take only these, and the icon buttons' hover selectors, here and the rail's in `panels/tree.css`, carry four classes' weight (`.icon-btn:where(…):not(:disabled):not(.unavailable)` and the hover), so a surface's own hover rule of the same weight after them can still win.

**A dialog's decisive button is filled**, in one of two colours of the same shape: `.primary` confirms (accent fill, dark text — the accent is a light blue, so white on it barely separates) and `.danger` destroys (red fill, white text).
Filled rather than outlined because `button:hover` sets an accent *border* app-wide, so a resting accent border is indistinguishable from an ordinary button being hovered — which is how the old accent-outlined Save read, and why it was replaced.
That same app-wide rule is why the hover state has to set the border itself, and it sets it to the fill: background and border are one colour, so the brightness step darkens the whole button and its outline never appears to move.
Each colour is named once, as a `--fill` custom property, which is what keeps that true — an earlier version reached for `currentColor` instead, i.e. the *text* colour, and hovered to a dark border on the blue button (it read as shrinking) and a white ring on the red one.

**Rows** come in three shapes: a **list row** (`.card`, a session's or a list panel's, built by `listCard`) is a card in the list body — `7px 14px`, surface radius, two lines and its own controls; a **menu row** (switcher entry, kebab-menu item, an entry in Settings' list of sections, the one on show `.active` as the switcher's project on show is) is `6px 9px`, control radius, one class and one hover for both (`.menu-row`), which each of them carries and whose stylesheet each of their modules imports; a **compact list row** (a list panel whose list says `compact`) is the list row without its card — `3px 8px` with the heading's 14px on the right, control radius, no fill and no gap, one line of text — for a list scanned many rows at a time, such as changed files.
The compact row is a shape of its own on purpose, though it resembles the menu row: a menu row is a choice in a menu, and a compact row is an item in a list, so it keeps the list row's builder, hover and controls and only drops the card (decided 2026-10-13).
The menu row for what is on show, the switcher's entry (a project, or All), wears one fill, `.menu-row.active`, and keeps it under the pointer.

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
`FitAddon` sizes from the box xterm opens in, and a `.term` around it is `display: none` until it is the active tab.
Fitting one before revealing it therefore yields xterm's 80×24 default rather than an error — and that default is what the PTY is told, so `claude` draws its entire TUI to 80 columns for the life of the session.
Reveal, then fit, then resize.
A session started out of sight, as a launch starts the ones that were running behind the tab on show, is revealed for the measurement alone and hidden again in the same task, which no paint comes between; with the terminal area itself hidden there is nothing to measure, and it is fitted when it is next selected.
Every conditionally-visible pane carries this hazard, split view included.
The whole terminal area is one now: it is hidden while another panel of its group is shown or its group is folded, so the tab fit refuses a terminal area with no size and leaves it to the `ResizeObserver` on it, which fires once the area has a size again.

**A hidden terminal's scrollbar goes to the top while its lines stay put.**
While a terminal's box is hidden the browser drops its scroll element to the top, and xterm 5 records that without scrolling its lines, so it came back drawing its last lines under a scrollbar at the top (seen 2026-10-30, measured 2026-11-08).
Every fit, the shells' and the claude tabs', goes through `fitTerminal` (`src/renderer/terminal.ts`), which scrolls the terminal a line away and back after the fit, and that scroll of its own makes xterm put the bar back where its lines are.

**A padded box fits the terminal too big.**
`FitAddon` takes the room a terminal has from the computed height and width of the element xterm opens in, less the padding of xterm's own element and the scrollbar's width, but not that element's own padding, and with every box `border-box` its computed size counts that padding.
A shell panel opened xterm straight into its 8px-padded box, so each shell was given 16px too much room each way: xterm's text layer, an opaque canvas, lay over the scrollbar's gutter, and its last row ran into the panel's bottom padding and could run past it.
So `createTerminal` opens xterm in an unpadded `.terminal-box` of its own that fills the container it is given, and a caller pads its container freely.
Rejected: `box-sizing: content-box` on the padded box, one line but a trap for the next caller.

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
Only two are `false`, each with its reason written beside it — `lastActivity`, rewritten on every message of a running session and drawn as the row's time, which a clock keeps current instead (§ UI conventions), and `postCompactHeads`, which no row reads.
`lastActivity` had once been marked as drawn by nothing, and every row's time stayed what it was at the list's last redraw.
The general rule this stands for: **where stale is worse than an extra rebuild, make the exhaustive case the one the compiler enforces**, rather than trusting a list to be complete.

**Two surfaces can disagree about the same list, because only one of them re-rendered.**
The session list is assigned before that signature check decides whether to draw, so a transcript merely growing updates the data and skips the render.
A surface rebuilt by the next status event then draws from the newer list while the sidebar still shows the older one, and seems to reorder itself on a dot changing.
Anything that reads the session list off a status event has the same hazard.

**A list you read while working needs to stay still more than it needs to be sorted well.**
Sorting attention-first — sessions by urgency, projects by their most urgent session — reshuffles both levels on every status change, and ordering by **recency** swaps two rows whenever the lower one writes a message, since a running session's timestamp is always moving.
The tab bar orders by **tab order**, which nothing on disk can touch — it changes when you open, close, drag or regroup a tab, and a drag persists — drawing a project's ungrouped tabs first and then one row per group in registry order (`orderAsTabs`); the session list's order catches up once a minute, never under the pointer (§ UI conventions).

**The tab bar and the session list put projects in the same order**, the one you set.
The tab bar used to order them by whichever project it met a tab for first — emergent rather than chosen, and it moved on its own: closing a project's last tab and opening another sent that project to the end.
Pins are deliberately not floated in the tab bar, unlike the sidebar: a pin says where a session belongs in the LIST, the tab bar has never honoured it, and floating one would be a second thing able to move a row you were reading.
