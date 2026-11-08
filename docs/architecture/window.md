# The window

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
The tab bar's fold is written in the same object, as the terminal area's part of it beside the sidebar's, each type saying what its part is (`claude/stored-view.ts`, `sessions/stored-view.ts`) and `view-saving.ts` putting them together.
Rolling date presets are recomputed from the current moment, so "last 7 days" still means the last 7 days; only a custom range is restored literally.
The filter panel comes back exactly as it was left, an active filter included — closing it over a filter you meant to keep is a choice to reclaim the space, and the filter icon carries an accent whenever anything is on.
The toggle is a funnel rather than a magnifier ([decided 2026-09-23](../decisions/0011-closing-the-filter-panel-keeps-the-filter.md)).
Closing the panel never hides the filter, though.
Closed over a filter that is on, the panel folds down to one row of chips, one per thing that is on — the search text, each pill, the date range — each with its own ×, and a press on the row opens the panel again; the count and Clear sit on the line below, where they also sit under the open panel ([decided 2026-09-23](../decisions/0010-a-closed-filter-panel-folds-to-chips.md)).
With nothing on, closing hides it all.
The count's total is the set the matches were taken from: the same project scope and the same view before the other filters, so the count only ever compares a set with part of itself.
The finished pill picks that set rather than narrowing it, since the finished view holds only finished sessions and the normal view none, so in the finished view the total is the finished sessions and the count says "finished"; in the normal view it is the number the switcher shows.
One rule, `inView` in `logic.ts`, decides which set a session is in for the list, the switcher's counts and the total alike.

Folds come in two states, and they are deliberately separate.
Filtering opens the whole tree so a match inside a folded section is never hidden, and folding from there is a way through the results — shut a project you have already been through — rather than a statement about how the sidebar should look.
So those folds apply only while a filter is on and are dropped the moment you change it, by any route: a character typed or deleted, a pill, a date preset or the calendar, a chip's ×, Clear.
A change drops them as well as an end, because new results can sit in a section folded for the old ones; a fold kept across changes could hide a match without saying so.
Collapse-all and a project's group jump act on them as they act on the folds you made without a filter.
Both states are stored, because the filter itself is restored, and coming back to the same results without the same view is the thing remembering the view is meant to prevent.

A **group** is a user-made sub-section inside one project.
Membership is one group per session, so it is stored as a session-id-to-group-id map — a session cannot be in two groups by construction.
Groups carry their own display order, and deleting one only unfiles its members; the sessions are untouched.
A group is made in one of two places, through one function (`promptNewGroup`): a row's "New group…" makes it around that session in the same write, so it is never briefly empty, and the project kebab's makes it empty.
Either way the list then jumps to it, because a new group lands at the top of its project, which can be far from the row or heading it was made from.
An empty group keeps its heading, which is how a new one is seen, except under a filter, which drops groups with nothing matching; a group made empty then is announced in a toast instead, since there is nothing on screen to jump to.

The nested shape (projects, their groups in order, then the sessions in no group, with pins floated inside whichever section they land in) is computed by a pure function in the renderer's `logic.ts`, so the ordering rules are unit-tested without a DOM.
A session started from a group's "+" is filed by the ordinary membership write, before its tab is built, so its row's first paint is already inside the group — there is no second, provisional membership anywhere, because the session has its real id from the start.

## The language

The app formats times and dates in the language the `locale` setting names, a BCP 47 tag such as `en-GB`, or in the system's while it is `""`, the default ([decided 2026-10-29](../decisions/0137-a-language-setting-for-times-and-dates.md)).
A tag is checked with `Intl.getCanonicalLocales` and kept in its usual case, so `C`, or `en_GB` as a `LANG` spells it, is refused as no tag.
There is no time zone setting: the app keeps to the machine's zone, as everything else running on it does.
The app's own words stay English whatever the language, the set-aside mark's "Mon 3 Nov" included.

**A time field follows it from the next launch, everything else at once** ([decided 2026-10-29](../decisions/0142-a-time-field-follows-the-language-from-the-next-launch.md)).
Chromium fixes a time field's format per renderer process, from the language the process starts with, so main starts the window's renderer with `--lang=<tag>` (`rendererArguments`, through `additionalArguments`), read afresh for each window, so one opened again on macOS follows a change too.
Measured on Electron 43.2.0 in a minimal app (2026-10-29): a window made with `--lang=en-GB` in its `additionalArguments` showed `14:15` in its time field, one with `en-US` AM/PM, each window by its own renderer, while `navigator.language` and a bare `toLocaleString` stayed the system's.
None of these changed the field at runtime: `lang` on the field or the page, the DevTools locale override (which changed `toLocaleString` only), the switch added then a reload, a new window or a fresh renderer, and `LANG` set together with the switch in main, then a new window or a fresh renderer.
So everything the app formats itself names the language rather than taking the window's default (`src/renderer/locale.ts`): a moment's tooltip in full, which `moments.ts` draws again as soon as the language changes, and a list panel's line under a failed run, which the panel draws again too.
The calendars take their first weekday from it (`Intl.Locale(tag).getWeekInfo()`, which Chromium has and the renderer's ES2022 lib does not type yet), Monday for en-GB and nl-NL and Sunday for en-US, and an open one turns to the new first day; with the system's language read as en-US the calendars start on Sunday.
`localeCompare` is left without a language: in the window it orders ISO times, and in main folder names, neither of which the setting is about.
