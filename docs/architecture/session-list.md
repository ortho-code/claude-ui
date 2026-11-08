# The session list

## Selecting several

The session list has a bulk mode, so that a project's or a group's sessions can be stopped, closed, marked finished, set aside or moved in one go rather than a tab or a row at a time (`sessions/bulk.ts`).
Select sessions… in a project's or a group's menu enters it with every row drawn under that heading ticked, a folded group's included, and Select… in a row's menu with that row ticked; only the row's menu has it, of a session's menus, since it acts on the list.
In the finished view both work too, and the bar there holds only what fits a session put away, Unfinished and Delete… (below); turning that view on or off ends bulk mode outside the review, which sets the filter aside, since it swaps which sessions the list holds and which acts the bar has, and ticks carried from one set into the other would act on rows ticked under another bar.
In it every row and heading has a box; a press on a row ticks it rather than opening it, a Shift+press ticks the run from the row last pressed, or from the last row Select sessions… ticked (`tickedRun`, `ticks.ts`), and a heading's box ticks every row under it, or unticks them all once every one is.
The line under the header counts what is ticked, with Done; Esc ends it too, unless it was typed where text goes or into a terminal, where claude reads Esc, or a menu, a dialog or the filter's calendar is up, which Esc closes instead.

Bulk mode is a slice of the store (`bulk`, `state/bulk.ts`), apart from what narrows the rows, so whatever narrows them, a search today and a view later, has the same boxes and the same bar.
It is not kept for the next launch: it is a moment of deciding, not a place the list was left in.

The bar at the list's foot acts on the ticked rows the list draws (`tickedOnShow`), a folded group's included, since folding only hides them: a row a search leaves out stays ticked, and comes back ticked, but nothing acts on it while the list does not draw it.
Each act is the write a session's own menu makes, given every key at once, so the bar and the menu cannot disagree about a pin or a tab; where the bar adds a toast with an Undo that the menu has not, Set aside… and Unfinished, it is because the bar's rows can leave the list (below):
- **Finished** is `finishSessions`, which a session's menu calls with one key: sessions no claude of the app's runs are marked finished in one write of `meta.json`, with one toast whose Undo makes them all unfinished and puts back each one's set-aside and needs-you marks and its tabs; one whose claude runs is asked to leave and marked finished at its exit, with its own toast, as alone; one with a tab starting is left out, as its menu's Finished is unavailable then.
- **Keep** takes every ticked session out of the review (§ The review) in one write, with one toast whose Undo puts each one's stamp back as it was, or none; it is offered outside the review too, to hold a session out before it would come up.
- **Set aside…** opens the menu's own dialog (`askSetAside`, [§ Status cues](status-cues.md#status-cues)) for every ticked session, marks them in one write, and raises a toast whose Undo puts each back as it was, its old mark or none.
  With several ticked the dialog has no line of where they stand and says their notes stay as they are ([decided 2026-11-05](../decisions/0170-set-aside-for-several-leaves-their-notes.md)); with one ticked it is that session's dialog, its note included, and the Undo puts the note back too.
  A session's menu raises no toast for Set aside… ([decided 2026-11-04](../decisions/0156-a-sessions-menu-raises-no-toast-for-set-aside.md)).
- **Move to group** is the menu's list (`moveToGroupItems`) for every ticked session, in one write, or two for New group…, which makes the group with the first and moves the rest; unavailable when they are in more than one project, since a group belongs to one.
- **Stop** presses each ticked session's Stop session where its menu offers it as a stop, never as a force: a tab already stopping is left to its own force, one starting is skipped, as its menu refuses it, and one leaving for a close or a finish is turned back into a stop, as its menu's Stop session turns it.
- **Close tab** closes each ticked session's tab by its menu's Close tab, never forcing one already closing: cold tabs at once, with one toast whose Undo puts them all back, and running ones once claude has gone, each with its own Undo then, as alone.

In the finished view the bar has two acts instead:
- **Unfinished** makes every ticked session unfinished in one write, with one toast whose Undo marks them finished again in one write, as of the Undo, since main keeps no finish time once a session is unfinished; a finished row's own Unfinished button raises none, as before, since there one row leaves where the press was.
- **Delete…** asks once for every ticked session, as a row's Delete asks for one (`confirmAndDelete`, which both call), then moves each to the trash, hiding them all at once and reading the list again once every delete has answered; one that fails comes back, and the toast names it, or says how many.

Move to group and Stop raise no toast, as alone; a batch that finishes or closes running sessions raises one toast for those that were not running and one more for each running one as it goes.
An act that would do nothing for any ticked row is unavailable and says why, as a menu's items are: Finished while every ticked session has a tab starting, Close tab while none has a tab it can close now, Stop while none runs or each is stopping already.
Main takes each of these writes as a list (`finish`, `unfinish`, `markSetAside`, `clearSetAside`, `keep`, `unkeep`, `moveSessionsToGroup`), so a batch is one write of `meta.json` and one line of its audit log, not one per session.

## The review

The review is a moment to decide what the list has been carrying: the Review button, on a row under the sidebar's header, opens the list on two sets in bulk mode (§ Selecting several), and every act of the bar that decides a row takes it out, until Done, Esc, or nothing left to decide ends it.
Its count is the review in the switcher's scope, and at none, while the list does not show the review, the button is unavailable, saying so, since a review with nothing in it would end at once; while it does, a press ends it.
The count is worked out again whenever what it reads in the store changes, and an open review is drawn again whenever the list is, a session getting or losing a tab included; since a session crosses its days, or a keep stamp runs out, with nothing in the store moving, the count is looked at again at least once an hour on a timer, as a set-aside mark comes due, and an open review every minute with the list's order ([§ UI conventions](ui-conventions.md#ui-conventions)).

**Which sessions** (`review.ts`, pure): those that are unfinished — no tab, not finished — not set aside, and not kept within the last 30 days, in two sets, oldest activity first:
- **Ready to finish**: every link settled, which today is every PR it links merged or closed, as the PR marks read what GitHub said (`verdictOf`); at least one link, since a session that links nothing has nothing settled and would put every such session here.
  A PR GitHub has not answered for is not settled, nor any after a failed ask, which the marks show as no state either, nor any while `prStatus` is off and nothing is asked.
  While a session the review would look at links a PR, the set's heading says why it cannot answer, rather than standing empty as if nothing were ready: PR status off, the failed ask's reason, or, while GitHub has answered for none yet, that it is asking; one PR among answered ones that GitHub has not answered for leaves its session out without a word.
- **Untouched 30+ days**: last active more than 30 days ago.
A session in both shows once, under Ready to finish; each row says why it is there in place of its time and model — in Ready to finish how its PRs settled and how long ago it was active, in Untouched how many days, with the start of its note — led by its project in All and its group where it has one, and the line is worked out again on the row's minute clock.

The conditions both sets share hold for every act that decides a row ([decided 2026-11-04](../decisions/0165-the-reviews-shared-conditions-hold-for-every-act.md)).
A session with a tab is work in hand, which its tab decides, so the review leaves it out whatever its PRs say.

**The terms are named for the query language** the session-model design brings later: `is:unfinished`, `is:set-aside`, `kept:<30d`, `untouched:>30d`, `is:ready-to-finish`, each one function, so the review and a query typed by hand cannot disagree.
The review is a definition, data rather than code in the list (`REVIEW`): its sets, each with a name, its term and its why line, and the terms they share; that is the shape a view in review mode takes once views are files, so the review then becomes a bundled view without a second implementation.
Its two numbers of days are written there and nowhere else, what Keep says of its days read from there too, and are fixed until views can be overridden ([decided 2026-11-04](../decisions/0164-the-reviews-days-are-fixed-in-its-definition.md)).

**Keep's stamp** is when a session was kept, in `meta.json` (`kept`), never an expiry: how long it holds is the review's own term, so it is worked out when read, nothing sweeps it, and a stamp past its days does nothing until its session is kept again or deleted, which takes it with the session's other marks.
Finishing leaves it, since a finished session is out of the review anyway.

**The list in review mode** draws the sets in place of the projects, each a heading with its count and its box over its rows, flat; the filter is set aside meanwhile — its toggle, panel and chips hidden, not applied, and the collapse-all button with them, since the sets do not fold — and comes back as it was, since the review is not a filter.
The folder part of "every link settled", no changes left in a folder only the session worked in, waits for links to folders: the app sees a session's changes through claude's file tools only, never through Bash, and a fork or a resume works in the same worktree, so which folder only one session worked in cannot be told; measured on 2026-11-04, every worktree the review's sessions had used was gone or clean, so it would have held none back.

## Recent

The session list lays its sessions out in one of two ways, switched on the row under the header, left of the Review button (`sessions/arrangement.ts`): Grouped, by project and group, and Recent, every session in the switcher's scope that passes the filter, flat, last worked on first (`recentOrder`, `recent.ts`), each row's line led by its group, and in All its project, as a review's row is (`whereOf`).
The order catches up with what was worked on as Grouped's does ([§ UI conventions](ui-conventions.md#ui-conventions)), and compares times rather than the text main compares, since the ISO form is how Claude Code writes them today rather than a contract.

**One flat renderer**: Recent and the review draw through the same code, sections of flat rows (`renderSections`, `FlatSection`), the review two under headings and Recent one without; what differs is data, which sessions, in what order, and whether a row's line says why it is there or its time.
The list's other groupings in the session-model design, such as by activity, are more producers of sections for it; project › group stays the tree it is.

**It is the panel's view**: Grouped and Recent are the sessions panel's two views, `grouped` and `recent`, kept as any panel's pick is, in the app's file beside the layout, with the layout entry's `view` where it starts ([§ Panel state](panels.md#panel-state)); the store's `arrangement` follows the pick ([decided 2026-11-04](../decisions/0157-grouped-and-recent-are-the-sessions-panels-views.md)).
The panel is bare, so the tree draws it no header and no switch: it draws its own, from the same builder as a list panel's (`viewButton`, `panels/view-switch.ts`), in words where a list's header has icons, and keeps a pick through its host (`PanelHost.pickView`).
Having no run, it is told when its pick changes without a mount (`viewChanged`), by an edit of its entry's `view` or by the app's file being read after it mounted, which a list shows from its next run instead; a pick kept on this machine wins over the entry's `view`, as any panel's does.

**It is not the review**: the arrangement is kept; the review is a moment over whichever is picked, not kept, and Done returns to it, so the two are apart in the store (`arrangement`, `reviewing`) rather than one slice of three values that would have to remember what Done goes back to.
While the review is open the switch is unavailable, saying the review keeps its own order.

**What holds across it**: the pick holds in every project, in All and in the finished view, where Recent lists the finished sessions flat, each row saying when it was finished, as there; switching keeps bulk mode and what is ticked, the rows on show being the same, only laid out otherwise.
There is no heading in Recent, so a run is ticked from a row's Select… and a Shift+press, and collapse-all is unavailable, saying Recent has nothing to fold; neither it nor a press on a tab unfolds anything in Recent, so the folds stay as they were for Grouped.
Where every session in scope is finished and no filter is on, Recent says so in place of its rows, as Grouped says it under each such project's heading.

**Pins are not floated in Recent** ([decided 2026-11-04](../decisions/0159-pins-are-not-floated-in-recent.md)), as the tab bar does not float them either ([§ Traps worth knowing](ui-conventions.md#traps-worth-knowing)).
The pin stays on the row, and the pinned filter finds them.

**The tab bar's names** land, in Recent, on the newest row drawn of that project, or of that group, and flash it ([decided 2026-11-04](../decisions/0163-tab-bar-names-land-on-the-newest-row-in-recent.md)).
