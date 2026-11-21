# A checkout's base is picked in a dialog

- **Date:** 2026-11-20
- **Area:** [The `explorer` type](../architecture/panels.md#the-explorer-type)

## Decision

What Since branched in a checkout is measured from is picked in a dialog, opened from Change the base… in the checkout's own menu while the checkout answers Since branched, the one question a base changes, and from the base the row over the Explorer's list names, which it does while the Explorer shows one checkout and the panel's question, Since branched, is that checkout's too.
The dialog lists Default first, then the local and remote branches of the repository but the one the checkout has out and any symbolic ref, the remotes' default branches first, then the local ones, then the other remote ones, each by name, with a search over them all.
Each branch's row says how many commits it would count as this one's own, asked only once the row comes into view, a few at a time.
A press selects a row and Save keeps it; a double click on a row, or Enter on one, selects it and saves, and Enter in the search saves what is selected; Save is unavailable while it would change nothing; Cancel and Esc send nothing, and a save already sent is waited for before the checkouts are read again.
The selection is kept for the branch the checkout has out, the first of the three layers of [0241](0241-a-diff-base-comes-in-three-layers.md).
Use for the whole project, under the list, opens unticked, since it is what Save does rather than a level to look at: ticked, Save keeps the selection for the repository's project, which every checkout without a base of its own measures from while it resolves, and drops this branch's own pick, so this checkout follows it too; Default ticked drops both, so every checkout without its own pick follows the guess; a checkout detached when the panel last read it has only the project, so the box is ticked and fixed there.
Default keeps no base of its own and says beside it, where a branch's count stands, what it then follows: the project's base in use, unless Save drops it, else the guess.
A box over the search says, In use, what the panel last measured this checkout from and why, and, Changed to, what Save will do in full, or No change, with Undo; each line is two lines high whatever it says, so the list under it keeps its place, and each name is a press away from its branch's row.
The list opens on the row selected: Default, at the list's top, while the branch keeps nothing of its own in use, else its own pick, or on a detached checkout the project's base in use, scrolled into the middle; the heading of the group at the list's top stays there while its rows scroll under it.
A checkout measured from the base its own branch keeps says so on its row, `from <branch>`, while it answers Since branched; a guessed base or the project's, shared by every checkout of the repository, gets no mark.
That mark takes its own width, up to 11em and never more than 45% of the row, and does not shrink, so the checkout's name gives way instead and a long name leaves the base readable.

## Why

A repository can have thousands of branches, which a menu cannot search and a submenu cannot hold, and each count is a walk of the history, so counting them all before showing any would keep the dialog empty for seconds.
Git keeps a branch out in one checkout at a time unless forced, so a base kept for the branch is in practice a base for that one checkout, and no layer is needed beyond the three that were there; it follows the branch to whichever checkout has it out later.
A local branch is offered too, since a branch stacked on another is measured from that one.
A mark only where the checkout is measured from its own branch's base follows the question's mark: a row says why its count differs from its neighbours', and says nothing where it does not.
Under Unpushed or Uncommitted a pick changed nothing in the list or on the row, only the commits the menu counts for Since branched, which read as a pick that did not work, so the base is offered only where it shows.
A tick on the branch in use could not tell a branch picked by hand from the same branch reached by falling back, as Follow the panel tells a question set on its own from the panel's; Default says the same of a base.
A press that kept at once and closed the dialog made it hard to see what a press would do; selecting first, with the box saying what Save will do, makes each step visible.
A box that showed the project's level while ticked opened ticked whenever the project kept a base, so a press meant to tick it unticked it and changed what the list, its ticks and Save meant; read as "this repository, this branch included", it does one thing, and opens the same way every time.
The project's base belongs to a repository, and the project menu in the session list reaches only the session's own folder, not a repository nested in it, so it is set from the checkout.
The box sits under the list so the search and the list stay together.

## Turned down

- A press that keeps the branch at once and closes the dialog: annoying when picking, and unclear with the level choice in play (decided 2026-11-20).
- Use for the whole project as a level the dialog shows, ticked on opening while the project keeps a base: a press unticked it unseen, and it read as every checkout but this one (decided 2026-11-21).
- The project's base set elsewhere: from the question menu over the list or the panel heading's folder menu, from the project menu in the session list, which cannot reach a nested repository, or by hand in `settings.json`, which holds nothing per folder (decided 2026-11-21).
- Two fields, one per level, each with its own list: one list with the project as what Save does keeps the dialog to one choice (decided 2026-11-21).
- In-use tags on the rows and a line over the buttons: the box says both in one place (decided 2026-11-21).
- Default as a row of its own above the list, named Follow the project's base or Follow the guess: it looked apart from the branches it is a choice among, and its name changed with the level (decided 2026-11-20).
- Two buttons, This branch and Whole project, in place of the checkbox (decided 2026-11-20).
- A mark that gives way first, down to a stub, before the checkout's name: next to a long name it showed only `f…` (decided 2026-11-20).
- Change the base… under every question, or a pick also setting the checkout to Since branched: the first changes nothing in the list, the second changes a question nobody picked (decided 2026-11-20).
- Back to the default, a button shown while a level keeps a base: beside a tick on the branch in use it left open whether the base was followed or picked (decided 2026-11-20).
- Default named after what it stands for, Follow the guess at both levels: wrong at the branch's level while the project keeps a base, which is what that branch then follows (decided 2026-11-20).
- A searchable popover at the checkout's menu: cramped in a narrow panel, and a second kind of menu beside the shared one (decided 2026-11-20).
- A pick kept for the branch first, then a button to use it for the whole project: two presses, and the branch's pick left to clear (decided 2026-11-20).
- One list of every branch by name: the defaults, the usual pick, sink among the rest (decided 2026-11-20).
- The checkout's menu as the only way in: the base the row over the list names invites a press (decided 2026-11-20).
- No mark for a kept base: a count that moved needs its reason in sight; a mark on every checkout: one base repeated on every row of a repository; an icon with the base in its tooltip: hidden until a hover (decided 2026-11-20).
- Counting the first thirty branches and asking for a search to see the rest: every branch is listed at once, and a count costs only once its row is seen (decided 2026-11-16).
