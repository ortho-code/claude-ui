# Sessions

The app lists your `~/.claude` sessions grouped by project, runs several of them at once in tabs with live status cues, and covers the session lifecycle: start, fork, worktree, pin, finish and delete.
What a session's dot says, and what marks it as needing you, is in [Status and what needs you](status.md).

## The session list

- The list is read from `~/.claude`, grouped into collapsible projects, and refreshed live as transcripts change on disk.
- Custom groups are sub-sections inside a project, made empty from the project's kebab or around a session from its kebab.
  Move a session between them, rename or delete a group (its sessions stay), and start a session, a fork or a worktree session straight into one.
- Reorder projects and groups from their kebabs, fold every section away and back from one button over the list, and attach a note to any session.
- A jump list on the project heading reaches a group without scrolling.
- Recent, beside Grouped under the header, shows every session of the project on show, or of all of them, in one flat list, last worked on first, each row naming its group and in All its project; filters and the finished sessions work in it as in Grouped, and selecting several from a row's menu.
  In either, a session worked on again moves to its place within a minute, never while the pointer or the focus is in the list or a menu from it is open.
- Search plus filters: pinned, open, live, set aside, worktree, siblings, linked PR, noted, finished, folder gone and a date range.
  A filter left on with its panel shut stays on screen as a row of chips, one per thing that is on, above the count.
- A project switcher scopes the sidebar and counts the sessions in other projects that need you.
- A session whose folder is gone says so, in its row and on its tab, and refuses to start, instead of starting somewhere nobody chose; pinning, notes, finishing and deleting still work.
  A project whose folder is gone says so too, in the project switcher, on its heading and in the tab bar.
- Projects can be renamed.

## Claude tabs

- Each open session has a tab with an embedded terminal running the real `claude` CLI: a click resumes it (`claude --resume`), and new sessions start there too, named when you fork one or create a worktree.
- Several sessions are open at once; drag a tab to reorder, and open tabs cluster by group in the tab bar, where a group's name takes you to the group in the list.
- The tabs are restored on the next launch, where the sessions that were running come back marked as needing you, started again too if you choose, and the rest wait.
- A tab's own button stops the session before a second press removes the tab, or marks the session finished if you choose that in Settings.
  A session that asks something on its way out, such as whether to keep its worktree, is answered in its tab, which stays until claude has gone, its dot pulsing meanwhile; one that has not gone a second later can be forced.
  A stop, close or finish claude has not left three seconds after the ask says "hasn't left" beside the session's name, and, when its tab is not on show, in a toast that stays until claude leaves and takes you to the tab.
- A tab you close or a session you mark finished can be put back from the message it leaves, with Undo; a close's message also offers Finished and Set aside… for the sessions it closed, each with an Undo back to before the close.
- The tab bar folds to one row, the row of the tab on show where there is one, from a chevron on the line under the tabs, to give the terminal the room; while a tab folded away is waiting for you, is ready and not marked read, or needs you, the chevron turns into its status dot.
- Sessions are followed the way they actually run: stopping one escalates until it has really ended, a `/clear` carries on in the same tab and group as a new session, and a `/model` switch shows at once.
- A running session whose last turn left a task scheduled, a `/loop` wakeup or a cron of the session's own, shows a clock beside it, naming each task on hover with a cron's schedule and what a stop does to it; a tab you stopped keeps it, muted, for the crons that come back, also after a restart.

## A session's menu

- A session's kebab holds everything about it, one menu on its row, its tab and a panel's row that names it: what the session is, at its top — title, project, group, each state it is in with its dot, such as ready and needing you at once, where its dot shows only the strongest, when it was last active and on what model, when it was finished, worktree, the start of its note — and the actions its row and tab offer, such as open, show in list, pin, mark read, stop, close, besides fork, siblings, PRs, worktrees, what is scheduled, set aside, note, group, copy id and finished.
- Its kebab stops a running session, and closes it or marks it finished, each in one press, also while claude is on its way out, where one pressed changes what its going does; not while it starts.
- A finished session's row has one too, with what it is, its siblings, PRs, worktrees, what is scheduled and its note, its id, unfinished, delete and select.
- A project's and a group's kebab start a session there, plain or in a worktree, and a project's starts one in any of its groups, a group a filter hides included, and jumps to one of its groups or to its ungrouped sessions.

## Forks and worktrees

- Fork a session (`--fork-session`) and start sessions in a fresh git worktree (`claude -w`).
- Sessions sharing a conversation show as siblings, with a fork badge and a jump list.
- Worktree sessions file under their main repo with a badge, including sessions that entered a worktree mid-life, and a session that has since left its worktree keeps the badge, muted unless claude's newest change is in a worktree.
- A session that changed files in other checkouts than the worktree its badge names, such as a worktree it reached by path or with a `cd`, has the badge count and list them, with the worktree it names, and picking one there points the panels at it while that session is on show.

## Pull requests

- The PRs a session links, as Claude Code records them in its transcript, those it posted a review or comment on with a `gh` command naming the PR's repository, and the one a panel row's `session` action names with `pr`: a badge on its row that lists them, an entry in its options, and each opening its page in the browser; a filter finds the sessions with one, and search finds a session by a PR's number or words of its title.
- Each PR is listed by its number and title, with its repository under it, or in front of the number where the session links PRs in several; until GitHub has given a title, by its number alone, and from launch by the title it last gave.
- The badge takes the colour of what GitHub says of them — changes requested, failing checks or a merge conflict, ready to merge, all merged or closed — asked with `gh`, and each PR GitHub has answered for is listed with its state, its approvals, and, where it is not yours, who opened it and whether you review it.
- Ready to merge waits for the approvals a repository needs where you set a number ([Settings](settings.md)); your own PR needs you for its checks, conflicts, change requests and approvals, and one you review for new commits since your review and your review asked again.

## Finishing, setting aside and the review

- Pin, Finished, and delete (to the OS trash); a project whose sessions are all finished stays in the list until they are deleted.
  Finished is one press on a running session too: claude is asked to leave, its tab staying for anything it asks on its way out, and the session is finished once claude has gone; the app does not open a finished session again until you make it unfinished.
- Set aside… in a session's kebab asks when to come back, from your own choices, a day and time you pick or whenever, and where it stands, which is the session's note, shown as a bookmark on its row and its tab, and a filter finds them; at that day and time it needs you, within the hour if the machine slept through it, and a needs-you mark from before it was set aside stays dimmed while it stays set aside.
- Selecting several sessions, a project's or a group's from its menu or one from its row's, puts a box on every row and heading, and a bar that marks finished, sets aside, keeps out of the review, moves to a group, stops or closes the tabs of every one ticked, in one go, with one Undo for what it finishes, sets aside, keeps or closes of the sessions that are not running; among the finished sessions it makes them unfinished, or deletes them after one question for all.
- A review, from its button under the header, lists the sessions without a tab that are ready to finish, every PR they link merged or closed, or untouched for 30 days, each saying why, to mark finished, set aside or keep out of the review for 30 days in bulk, until nothing is left to decide.

## The history

- A history of each session, from its transcript and laid out as claude shows it: every request, message, tool call and subagent's report since the session began, compactions included, with pins for the ones to come back to.
- A bar beside the terminal marks them all and works as the history's scrollbar, pressed or dragged, a loupe on it steps through a long session one entry at a time, and Ctrl+Shift+↑ and ↓ step between your requests.

## The window

- It opens the way you left it: window size and position, the sidebar's search, filters, folds, width and scroll offset, and the tab bar's fold.
- The window's layout is yours to arrange, with panels beside the sidebar and the terminal; see [Layout and panels](layout.md).
- Every mark is an SVG icon, clickable icons share one mark size and one hover for each kind, a borderless one turning accent blue, a bordered one filling, and radius and type come from tokens.
