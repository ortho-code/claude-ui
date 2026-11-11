# Claude tabs

## Claude tabs

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
`src/shared/config/flags.ts` holds both halves — the parser that turns the user's line into arguments, and the reserved list — and a test asserts that everything the launcher emits appears in that list, so a new app flag cannot be added without reserving it.

### The app chooses the session id

Every session the app starts is created under an id the app mints, handed to `claude` as `--session-id`.
The transcript then lands under exactly that id, so a tab knows which session it is running before the process has even spawned — and everything keyed by that id (the sidebar row, a group, a pin, a note, the status file) is right from the first paint ([decided 2026-09-22](../decisions/0006-the-app-mints-the-session-id.md)).

A fork is the one launch that names two sessions: `--session-id <new> --resume <parent> --fork-session`, and `claude` honours both, so a fork is a row of its own immediately rather than one that arrives with the next disk read.

`claude` refuses an id that is already in use, which turns out to be the same question as "does this session have a transcript" — nothing is written until the first prompt, so a session that never got one can be started again under its own id, and a session that has one is resumed by it.
That is the single test `startTab` makes, and it is why a tab stopped before its first prompt keeps its identity instead of coming back as a different session.

**What the flag cannot cover is an id changing mid-life**, and two things do that: `/clear` ends the session and starts a fresh one in the same terminal, under an id Claude Code chooses, and claude's own `/resume` ends it and goes on in another session that already exists, under that session's id.
So a tab also carries a token, set as an environment variable on its pty and echoed back by the status hook, and a reported id that differs from the tab's own replaces it.
claude's `SessionStart` says which of the two it was (`source` is `clear` or `resume`, measured on claude 2.1.302), and the hook script passes it on.
Without that the tab goes on naming the session that just ended, and resuming it later reopens the wrong history.
The token names the **terminal**, not the session, which is exactly why the tab's own id could not do the job.

### A cleared session is a new session

`/clear` is "start again here", so the app treats what comes out of it as a session with nothing in it: the folder is all that carries over, and the tab reads `New: <project>` until the session has something of its own, exactly as one started from the "+" does ([decided 2026-09-22](../decisions/0003-a-cleared-session-starts-empty.md)).
Its predecessor keeps everything of its own and stays in the list: it is a real session with a real transcript, and still resumable.
Only the **group** follows the tab across, because a group says where the work lives and clearing does not move the work.
A pin and a note are about one conversation, and that conversation still has its row to hold them.

**The title on disk is left exactly as Claude Code writes it**, and that is a deliberate limit on the above ([decided 2026-09-22](../decisions/0008-the-title-on-disk-stays-as-claude-code-writes-it.md)).
Claude Code copies the cleared session's `custom-title` into the new transcript, as its first record, in the same record a deliberate name is written to — and since a title from Claude is a session's name before anything else ([§ Reading sessions](sessions.md#reading-sessions)), a named session goes on wearing the name it was handed, and Claude's automatic title generator gives it no other while it has that one.
`/rename` with no name is the way out: Claude then generates a name from the conversation and writes it as the session's custom title, so both show it.

What is kept is the **pairing**, appended to the audit log: which session became which.
Nothing reads it back.
It is recorded because it is observable exactly once and nowhere else — neither transcript points at the other — and whether a cleared session should be shown as related to its predecessor is a question better answered later from what happened than guessed at now.

### A resumed session is the session it was

claude's own `/resume` goes on in a session that already exists, so the tab takes that session as it is: its row, its title, its group and its pin, with nothing carried over from the session before and no pairing recorded.
Doing a clear's part to it would move a session with a group of its own into the tab's, and keep the move.
Where a status event names another id than the tab's before any start has said why, the tab takes it the same way: only a start that says `clear` does a clear's part.
A `SessionEnd` never moves a tab, since it says the reporting tab's claude has left that session: main reads each status file as it changes, and the reads can finish in either order, so the session a tab left can report its end after the next one's start.

Finishing is this app's, and claude cannot see it, so its `/resume` can land in a finished session.
That session is made unfinished as soon as the app hears of it, and a toast says so, since nobody pressed Unfinished: the app opens no finished session (§ A session's menu holds everything about it), and claude has already gone on in it ([decided 2026-10-20](../decisions/0091-a-resume-into-a-finished-session-unfinishes-it.md)).

A session that another tab holds is a different case, and there the switch is undone.
claude lets a second claude resume a session another runs, with no warning, and the two then branch its transcript: each one's turn hangs off the same message, and a later resume follows one branch, dropping the other's turn (measured on claude 2.1.302).
So the claude that switched is forced out as soon as the app hears of the switch, before any turn of its own unless one was submitted first; its tab never takes the session over and stays on the one it ran before, cold once that claude has gone; and the tab already running the session comes on show, with a toast saying why ([decided 2026-10-20](../decisions/0088-a-claude-resuming-a-held-session-is-forced-out.md)).
It is forced once: a report from it while it goes asks nothing more, nor moves its tab to another session, also once the tab it clashed with has stopped (`forced`).
A claude you had asked to leave is forced the same way, its leave called off ([decided 2026-10-28](../decisions/0119-a-leaving-claude-that-resumes-a-held-session-is-forced.md)).
On its way out it reports the session's end, and an end reported from another tab than the one holding the session is not that session's, so the running tab's dot keeps its own.
Only an end: one the app reads from a transcript carries the tab the status file last named, which after a restart is not the tab running the session, and is the session's all the same.
What that claude writes to the session's status files stays as it wrote it: its start empties the list of work the running tab's last turn left running, until that tab's next turn ends, and its end says closed, until that tab's next report.
A tab that holds the session with no claude behind it, cold, runs nothing that could branch it, so it goes, and the tab that resumed the session keeps it, with the session's status, which is that tab's now.

### Tab lifecycle: a tab can exist without a process

A tab owns at most one terminal, and `terminalId` is **nullable** — null means the tab is **cold**: it has its row in the bar, its title and its place in the layout, but no `claude` behind it.
Cold is a first-class state, not an error one.

A tab goes cold in two ways: it is **restored** that way at launch, or the user **stops** the session with the tab's own button.
What a launch does with the tabs whose sessions were running when the app closed is a setting, `runningSessionsAtLaunch`: by default (`cold`) it restores them cold, so they cost no process ([decided 2026-10-08](../decisions/0064-restored-tabs-come-back-cold.md)), and `start` starts those whose folders are still there; either way it marks their sessions as needing you, unless the type `app.was-running` is switched off ([§ Status cues](status-cues.md#status-cues), [decided 2026-11-06](../decisions/0182-marking-restored-sessions-is-the-types.md)).
The setting's older values `mark`, `pause` and `leave` are read as `cold` ([decided 2026-10-28](../decisions/0130-restored-tabs-are-not-paused.md)).
The running list a launch reads is written at each start and exit of a tab's claude, and a quit only stops those writes (`persistOpenTabs`), so a launch after the app ended without quitting, a crash, a kill or a shutdown, marks the same sessions.

**The needs-you mark is the session's, kept in `meta.json` by session id with every reason it was marked for** (`needsYou`), so it outlives a launch that leaves the session unopened: the next launch has nothing running to mark, and the mark from before stays with its reasons; one that ran again, started at launch or resumed without a prompt, is marked again, how the app closed this time replacing how it closed before.
A session keeps every reason rather than the newest alone ([decided 2026-10-29](../decisions/0138-a-session-keeps-every-needs-you-reason.md)): a new reason is added beside the others and replaces the reason of its own kind, how the app closed, a reminder, or every reason of one PR (`markedNeedsYou`); a file that holds one reason per session reads it as a list of one.
Each reason is of a type ([§ Status cues](status-cues.md#status-cues)): `{ "type": "app.was-running", "at", "how" }`, `{ "type": "app.reminder", "at" }`, or a PR's change, `{ "type": "pr.merged", "at", "pr" }`, several changes found in one look at a PR a reason each at the same moment, so a PR's next change replaces all of them ([decided 2026-11-06](../decisions/0184-needs-you-reasons-have-types.md)).
A reason in the older form, `{ "reason", "at" }`, how the app closed being the reason itself, and a PR's changes one reason holding them all in `changes`, is read into types, one reason per change, and each reason is still written with that older form beside its type (`storedNeedsYou`), so a build from before types, which ignores `type`, reads every mark, and what it writes back reads as the same reasons; nothing released knows `needsYou`, so the next release drops the older form.
Its reason is how the app closed, from main's log: the newest log file, of any kind since a launch that quit with a process of the app dying in it is kept as a crash log, ends with the quit line (`quit`), without it (`ended`), or cannot say (`unknown`: no file, or one handing on to a next day's file since deleted), and a macOS window opened again from the Dock is `unknown` too, since the app never closed.
A launch also forgets the status its file still held for each session it marks: after an end without a quit the file still says what the claude that has gone last said, and its busy or waiting would show over the mark.
It is settled by acting on the session, not by looking at it ([decided 2026-10-28](../decisions/0133-the-needs-you-mark-is-settled-by-acting.md)): a prompt submitted there (`UserPromptSubmit`), Clear needs you in its menu, its tab removed by you or by your leaving claude, which exits 0 with no signal, its tab going on in another session by `/clear` or claude's own `/resume`, a finish or a delete.
Opening it, and claude resuming it, do not, so a session opened and left is still marked; a click on its dot marks it seen, dimmed as a read ready or waiting is, and keeps it.
Claude's own exit otherwise removes the tab and keeps the mark, so the session stays marked in the list: a signal claude catches exits with a code of its own, and one it cannot, SIGKILL or a native crash, reaches the window as code 0 with the signal, which main passes on with it (measured on claude 2.1.310: `/exit`, Ctrl-D and two Ctrl-Cs exit 0, SIGTERM 143, SIGHUP 129, SIGKILL by its signal; node-pty's own code for the last).
An exit within a start's first moments keeps the tab, as a failed start, and so the mark, whatever its code; the quit's own exits keep it too, since the mark is for the launch after it.
Undo of a close or a finish puts the mark back with the tab, from when it was marked.
**Each session keeps the history of its reasons** (`needsYouHistory` in `meta.json`, [decided 2026-11-06](../decisions/0179-each-session-keeps-its-needs-you-history.md)): a reason that is settled moves there, as it stood, with when it was settled and by what, `prompt`, `cleared` (Clear needs you), `closed` (its tab removed by you or your leaving claude), `moved` (`/clear` or claude's own `/resume`), `finished`, or `replaced` (the next close of the app, or the same PR's next change), newest first.
Main moves it in the same write that takes it off the standing reasons (`settledNeedsYou`, `markedWithHistory`), so the two never disagree, and the window keeps no copy, since nothing on screen reads it yet; the Session panel and the files that report a session's state are to.
Undo takes the entries back off as it puts the reasons back (`restoredNeedsYou`), so an undone close leaves no trace; a delete takes the history with the session, and a finish leaves it, so a finished session still says how it ended.
It keeps the newest 20 per session (`HISTORY_KEPT`, [decided 2026-11-06](../decisions/0183-needs-you-history-keeps-the-newest-20.md)).
A build from before the history keeps it untouched, as a key it does not know (`extra`), and records nothing it settles.
Claude asking or ready is never in it: those come many times an hour, and the transcript already holds every turn.
A turn claude starts itself fires `UserPromptSubmit` as yours does (measured on claude 2.1.310): a background task's end, its prompt a `<task-notification>`, and a cron firing, its prompt the one its `Stop` lists, the same text, twice a minute apart; in that run nothing else in the payload told them apart.
Claude's hook schema names a `source` for it, `user` for its prompt box and others for wakeups, crons and task notifications, which 2.1.316 still does not send, read from its binary.
So the hook script passes the prompt along with that status, and its `source` where there is one, and the window takes the mark off only for a prompt of yours (`startedByClaude`): by its `source` where it has one, else one that is neither a `<task-notification>` nor a scheduled task's prompt, against what the session has scheduled: what its last `Stop` listed, and the crons its tab kept from the claude before, which come back with a resume and can fire before any `Stop` lists them.
A `/loop` wakeup is in the `Stop`'s list only, since a tab keeps crons and not wakeups across a stop, and what its firing submits is not measured.
With `start`, the tab's kept crons can be dropped before its claude reports, as their status files' removal at launch can reach the tab after its start (`scheduledReported`), so a cron firing before the first `Stop` then takes the mark off.
A prompt you type that is exactly a scheduled task's leaves the mark, and one over 1000 characters is not matched and takes it off, since claude lists a cron's prompt cut to 1000 characters with a `… [+N chars]` marker (its `Stop` hook schema, 2.1.310).
One gap is known: main reads the status file after a watch event and each hook overwrites it, so a later hook, a `PostToolUse` most often, landing before the read names itself and the prompt is missed until the next one.
It leaves cold by being activated, which starts it immediately; there is no separate "start" affordance, because selecting a tab has always meant "work in this session".

Activating a tab can only ever **resume** it: the tab's own session is all it knows about.
The arguments that apply to a session's first start and to nothing afterwards — `--fork-session`, `--name`, `-w` — belong to the call that creates the tab, so that call selects the tab *without* starting it and starts it itself.

Two exits must stay distinguishable.
A **user stop** sets a `stopping` flag before asking claude to leave, and the exit handler checks it first: that tab is cooled and kept, or removed when the stop was a close or a finish, which marks the session finished too (`onExit`).
**Any other exit** closes the tab, which is deliberate — it stops a finished session leaving an empty tab behind.

That separation is what the tab's button is built on: ending a session and removing a tab are different intents, so one press does not decide both.
The first press stops a running session and leaves the tab cold, the second removes it, and a tab that is already cold goes in one.
A session arriving disables the button rather than merely ignoring it, and so does one leaving, for its first second and again once it has been forced: a tab acted on before its process has arrived, or in the moment its process takes to go, would leave the bar disagreeing with what is actually running.
A session still there after that second makes the button a force (§ Stopping a session is a request).
The button is a shortcut to one of the menu's leave items (§ A session's menu holds everything about it), Stop session on a running tab and on a cold one Close tab, or Finished where the `leaveButton` setting says `stop-finish` ([decided 2026-10-28](../decisions/0131-the-leave-button-can-be-finished.md)), and while claude is on its way out the force of what it is leaving for, whichever item asked, so it stays the press that ends claude (`tabButton`).
The setting is the app's rather than an option of the terminal area.
Its two default choices keep the two steps above, so a running tab's button never removes the tab on its own; `close` and `finish` give that up for one press, which asks claude to leave as the menu's Close tab and Finished do, and `none` takes the button away, the kebab holding every leave, with the kebab then ending the tab and keeping the gap it gave the button ([decided 2026-11-03](../decisions/0155-the-leave-button-offers-close-finish-and-none.md)).
A middle-click follows the button, so with `none` it does nothing.
The key names the button for what it does, a leave, and not for the tab ([decided 2026-11-03](../decisions/0154-the-leave-button-key-names-the-leave.md)).
The mark follows the state, so which press you are on is visible: a stop square while there is a session to end, a cross or the lidded box once there is only a tab, and for a force the stop square filled, or for a close or a finish the filled square with the cross or the finish's lidded box cut through it ([decided 2026-10-28](../decisions/0134-the-tab-buttons-mark-follows-its-state.md)).
Everything about the session is in a kebab beside the button, the button's own press among it: the session's menu, from the builder its row in the list uses (§ A session's menu holds everything about it), which the session list hands the tab bar through an ask (`sessionMenu`), since the two built-ins never import each other; a right-click on the tab opens the same menu from the kebab ([decided 2026-10-08](../decisions/0062-a-tabs-kebab-always-shows.md)).
The kebab costs a tab 12px, its own width: it takes the tab's gap before it and sits right against the button after it, and the cap on a tab's width is 212px ([decided 2026-10-08](../decisions/0061-a-tab-is-12px-wider-for-its-kebab.md)).
Every kebab is 12px wide, hugging its three dots, where a standard icon button is 24px and a compact one 22px: the dots are 2.6px wide, and the rest of the box was empty space that read as a gap between a kebab and the control beside it (`.icon-btn.kebab`, with a mark drawn only as wide as its dots).
Its hover and its open menu turn the dots accent and nothing else, as every borderless icon button's do ([§ UI conventions](ui-conventions.md#ui-conventions), Hover), since a fill on the 12px box was a thin sliver and a wider one ran into its neighbours.
A menu opened from it is placed so its notch can reach the middle of so narrow a trigger (`openMenu`).
A third case sits in between: an exit within 1500ms of launch is treated as a failed start, and the tab is kept with the error visible in its terminal.
Its process has gone, so the tab is cold like any other ([decided 2026-10-07](../decisions/0050-a-failed-start-leaves-the-tab-cold.md)) — its button closes it in one press, and selecting it starts it again on a wiped terminal, or says on the pane why it cannot — but until then its terminal stays on show in place of the pane and its history opens over it (`startFailed`), since what claude printed is the explanation.

The cold state is visible in three places, all reading the same `terminalId === null`: the tab is unfilled rather than dimmed, the session row's left bar and the selected tab's top edge are `--muted` instead of accent, and the terminal pane explains that clicking the tab resumes it.
Those two marks answer the same question, so they answer it the same way — accent means a live session, nowhere else.

A tab is never paused: setting a session aside is the set-aside mark, the session's rather than its tab's ([decided 2026-10-29](../decisions/0141-a-tab-can-no-longer-be-paused.md)), and what it does to a claude running in the tab, stopping it and by default closing the tab, is `setAsideRunning` ([§ Status cues](status-cues.md#status-cues)); a launch reads the paused tabs an older `meta.json` lists as sessions set aside, whenever, and restores their tabs as ordinary cold ones.
A roll-up, such as a project's in the switcher, and the attention toasts read the status itself, which for a session claude has left is `closed` and nudges nothing; a roll-up reads the session's needs-you mark too ([§ Status cues](status-cues.md#status-cues)).
A stopping dot never shows the session's mark read, and is no control, so a click on it goes to what holds it.

The sidebar has no live strip at its foot ([decided 2026-11-08](../decisions/0201-the-sidebar-has-no-live-strip.md)): the project switcher's badge counts the sessions in other projects that ask for you, and a list panel can name sessions and list what needs you and what runs from the sessions file (`asks`, `running`), with the session's dot, which marks it read, and its menu on each row.
The strip's stored keys, `stripExpanded`, `stripHiddenProjects` and an older `footerExpanded`, are read by no build and leave `meta.json` at its next write.

Where you were is remembered twice, in meta: `activeSession` (which tab to open on at launch) and `activeSessionByProject` (which to return to when you switch back to a project).
The in-memory `activatedSeq` still decides while a project has something running; the stored map only matters when nothing does, which is how a launch begins.
The remembered tab is *selected* at launch, and starts with the others only if it is one of them — a deliberately open question for one that is not, since a tab marked active with no process behind it is arguable.

What was running is remembered with the open tabs, in the same write: `runningSessions` holds the open tabs that have a process, from the moment it starts until it has gone, so a session still being stopped counts.
The window stops writing once the app quits, so the exits the quit causes are not recorded, and a launch reads the list before its restore writes the open tabs again; after a crash, the sessions running at the crash come back.
A file that still lists paused tabs, `pausedSessions` ([decided 2026-10-29](../decisions/0141-a-tab-can-no-longer-be-paused.md)), has them taken into the set-aside marks on each read until the next write drops the list, and one it also lists as running, whose pause still waited for claude at the quit, is not read as running, since pause never started or marked such a tab.
A tab loses the mark when its session's process arrives, and gets it back if that start fails within its first moments; a start that is refused or throws never had a process, so the mark stays.
The mark is written whenever it changes, with the rest.

The code is in `src/renderer/panels/types/claude/`: `terminals.ts` holds a tab's life from built to its claude's exit, the workspace switch and the fit of the tab on show to the terminal area; `leave.ts` asking a claude to leave, forcing one that does not, and the cold tab one leaves; `closing.ts` closing a tab and finishing a session, and the Undo each offers; `tab-state.ts` each tab's terminal; `open-tabs.ts` and `restore.ts` the open tabs kept for the next launch and their restore; `adopt.ts` a tab taking over the session its claude went on in.

### Stopping a session is a request: claude may answer it with a question

A stop, from the tab's button or the session's menu, and a close of a live tab ask claude to leave the way it is left in a terminal: Ctrl-C twice, 400 ms apart, from its prompt.
Mid-turn the first press only interrupts the turn, so a session whose hooks last reported it busy or waiting gets a third, and any other gets two, because a third at its prompt would arm claude's own "Press Ctrl-C again to exit" under anything it asks.
Waiting is a permission prompt, or a `Notification`, which claude also sends to a session sitting ready at its prompt, so such a session gets the third press too.
The presses are bytes written to the pty, which claude reads as keys while it holds the terminal in raw mode.

**A session with a task scheduled takes three presses.**
A pending `/loop` wakeup takes the first Ctrl-C to cancel itself ("Pending wakeup cancelled"), so two presses left such a session at its prompt, still running, with only the force to end it (measured on claude 2.1.302, 2026-10-22).
So a session whose last `Stop` listed a task, as its clock in its own colour ([§ Status cues](status-cues.md#status-cues)) shows, gets the third press too, from every route that asks claude to leave; a muted clock, kept from before its claude started, adds none.
The third press is one more whatever else takes the first: claude's handler cancels the wakeup and interrupts a turn in the same press, and three presses mid-turn with a wakeup pending left; at the question claude asks for a cron, "Background work is running", the third only arms "Press Ctrl-C again to exit" under it for a moment, and the question stays (both measured).
The list is the last `Stop`'s, so it can still name a wakeup an Esc at claude's prompt has cancelled since; the third press then lands on whatever claude asks on its way out, where one press only arms "press again" too (measured at the worktree question).
What becomes of the tasks was measured on claude 2.1.302 (2026-10-23), resuming with `--resume` as the app does: a `/loop` wakeup did not come back, whether the presses cancelled it or the session was forced out; a cron, one-shot or repeating, came back with the same id, even after claude's own question was answered "Exit and stop tasks".
The clock's tooltip says it of each task, a cron told from a wakeup by its transcript ([§ Status cues](status-cues.md#status-cues)): "comes back when you open the session" or "ends with the session".
It is said there, before a stop, and not asked at one ([decided 2026-10-24](../decisions/0110-a-tasks-fate-is-said-not-asked.md)).

**Nothing follows them.**
Claude can answer an exit with a question — a worktree session with uncommitted changes asks whether to keep the tree or remove it — and waits for the answer.
Nothing it sends tells asking from being slow: every stop probed on claude 2.1.289 printed something after the presses, and in the one run that logged hooks none fired in the 5 s the question was up.
So the tab stays, stopping, with its terminal kept and answerable in the tab, until the pty exits, however long that takes.
A close keeps the tab the same way and removes it when the exit lands ([decided 2026-10-07](../decisions/0057-nothing-follows-the-presses.md)).
Esc at the question calls claude's exit off, and the next prompt the session submits clears the stop: the status hook names the event that reported each status, and `UserPromptSubmit` is the one only a session that stayed can send once the stop is pressed.
A `/resume` or `/clear` there clears it the same way, whatever the leave was, a stop, a close or a finish: the app hears of either as a start of another session reported from the tab, which is going on working ([decided 2026-10-28](../decisions/0127-going-on-working-calls-a-leave-off.md)), and a `/resume` fires no `UserPromptSubmit` (measured; for a `/clear` it is not known).
A claude forced out, by its force control or by the app, is the exception: nothing it reports on its way out calls its stop off or moves its tab (`forced`), since it is being ended whatever it reports.
Until that prompt the tab goes on saying it is stopping.
A prompt submitted a moment before the stop, whose report arrives after it, calls the stop off just the same, and the exit that follows then closes the tab instead of cooling it.

**The stop shows for as long as it lasts**: the session's dot says `stopping` from the ask until the exit lands or a prompt calls the stop off (`dotStatus`), a pulsing square, in place of the last report, since that describes a claude on its way out.
The buttons say which it is too, the stop square, the cross or the lidded box, and the force they turn into after their first second is named and drawn for it, Force stop as a filled square, and Force close and Force finish as the filled square with the cross or the box cut through it; once the force is pressed they go back to the open mark, unavailable, until the exit lands.

**A stop claude has not left three seconds after the ask says so where it shows without a hover** ([decided 2026-10-24](../decisions/0108-a-stop-not-left-says-so-without-a-hover.md)).
That is any ask, a stop's, a close's or a finish's.
"hasn't left" stands beside the session's name in the colour of a session waiting for you, on its tab, and its row in the list, in place of the time and model (`notLeftWords`, `not-left.ts`); the row follows the session's first tab, which is its only one save while a `/resume` takes over a session another tab runs (§ A resumed session is the session it was).
A tab not on show gets an attention toast too, naming the session, saying "Claude hasn't left — it may be asking you something", and listing what it has scheduled, since claude may be asking about that (`toastNotLeft`): the toasts a turn's end raises, since this is the same news, and they stack, newest on top, up to four, where the message bar holds one at a time.
It stays until claude leaves, the stop is called off or forced, or it is dismissed, where a turn's toast goes after 5 s; a newer toast past the four pushes out the oldest that does not stay, so only a fifth stuck stop at once could push one out.
A click on it brings the tab on show, where the question is.
One toast per stop, so one dismissed stays dismissed; none is raised while the tab is on show, as a turn ending there toasts nothing, until another tab comes on show, and one already up stays when its tab is brought on show another way.
Three seconds is past most exits: of the 49 exits after an ask the app's logs held to 2026-10-23, half had gone by 1.43 s, 95 % by 2.98 s, and the slowest took 6.6 s, so a slow exit can still say so for a moment.
Claude can also let the ask pass and stay at its prompt: on 2026-10-21 a resumed session ready at its prompt for fifteen minutes was pressed twice and was still running 44 minutes later, when it was forced, with no question on screen and only a space in its input, while a fresh session with a space typed left on the same two presses (claude 2.1.302), so the cause is unknown.
Another resumed session let a two-press ask pass the same day, and left at the next ask, 25 minutes later.
Nothing in the app asks it again: in the menu of a tab whose claude is on its way out, the item of what was asked is its force, and the others only change what the exit does (§ A session's menu holds everything about it), since more presses would land on a question claude asks meanwhile, and a second pair ends such a question unanswered — measured on claude 2.1.302 at the worktree question and at the one about background work, where the tree was then kept and left locked.
The way out of an ask claude let pass is the terminal's own: open the tab, see what it shows, and press Ctrl-C there, or force it.
Main still drops an ask while the presses of the one before are being sent, or once the session has been forced.
Ending it is still the user's: the app forces a session out on its own only when you quit, when its window closes on macOS, when its tab is removed while its claude is still starting, as deleting the session does, and when a claude's `/resume` takes a session another tab runs (§ A resumed session is the session it was), and never because an ask went unanswered ([decided 2026-10-21](../decisions/0095-an-unanswered-ask-is-never-forced.md)).

A session still there a second after the ask can be **forced**: its stop control, disabled for that second so a double-click cannot force before the question is on screen, then sends the process group `SIGTERM`, and `SIGKILL` if it is still there after the grace below.
Quitting the app forces every session without asking, since a question would have nobody to answer it, and a panel shell's stop forces it too, since a shell has no Ctrl-C exit to be asked through.
Closing the window on macOS, where the app stays without one, forces them the same way: a window opened again from the Dock brings back the ones that were running as `runningSessionsAtLaunch` says, starting them afresh when it says start, and were they not forced, a start would put them beside the old ones, which no window could reach any more.
So a window opened again waits, as a quit does, until what the last one ran has gone.

Forcing is one function, for every route ([decided 2026-10-07](../decisions/0055-forcing-is-one-function.md)).

Two things make it work now.
**The signal goes to the process GROUP**, not to the process the app spawned.
That is the part that matters here: the app never talks to `claude` directly, only to a login shell that runs it, with `claude`'s MCP servers below that — so signalling the one process it knows about is the one thing guaranteed not to reach what it means to stop.
It is sound because node-pty's child leads its own session, measured rather than assumed: `pid == pgid == sid` for every live session, so the pid doubles as the group id.
**And it escalates**: `SIGTERM`, then `SIGKILL` for anything still there after a 3 s grace.
A worktree session left on `SIGTERM` in 0.75 to 1.52 s across five runs, and ran its SessionEnd hook on the way in the one run that logged hooks ([decided 2026-10-07](../decisions/0059-the-force-grace-is-3-s.md)).
Whether the first worked is read from the pty's own exit — the one place a session is recorded as over — rather than inferred from having sent something.
A session that left politely is never killed afterwards, because by then its pid may belong to somebody else.

`before-quit` delays the quit until everything stopped has gone, or the grace and half a second more have passed, which is what gives the escalation room to land, so quitting is not a special path.
It waits for the exits rather than for a fixed time, so a quit with only claude sessions to wait for is usually over well inside the grace.
A panel's shell is asked with `SIGHUP` rather than `SIGTERM`, the signal a closing terminal sends ([decided 2026-10-07](../decisions/0051-a-panel-shell-is-asked-with-sighup.md)).
The shell passes the `SIGHUP` on to a command running in it, which sits in a process group of its own, so a command that ignores `SIGHUP` outlives the shell.
The group is not swept again after its leader exits ([decided 2026-09-22](../decisions/0004-no-group-sweep-after-the-leader-exits.md)).

### A session's menu holds everything about it

A session's kebab is one menu on its row in the list, its tab and a panel's row that names it, built by one function (`sessionMenuItems`, `sessions/actions.ts`) and told which of the three opened it (`SessionSurface`); the tab bar and a list panel ask the session list for it (`sessionMenu`).
A panel's row goes to the session from Open, project and row too, and its own actions beyond its buttons sit under the menu's header, before the session's items, so the row has one ⋮ ([decided 2026-11-08](../decisions/0188-a-panel-row-has-one-kebab.md)).
**The kebab is complete; a button is a shortcut** ([decided 2026-10-19](../decisions/0087-the-kebab-is-complete.md)).
Every button, control dot and mark that opens something on those surfaces has its item in the menu, and so does a press on the row, on a panel's row and on a cold tab, so a session in another project can be dealt with from a panel's row, and one whose tab is all you see from the tab.
A window check holds the rule (`kebab-complete.spec.ts`): it finds each surface's controls in the page and fails on one with no item, naming it.
Outside the rule, by decision: a running tab's own press, which brings it on show and shows its row; its drag, which places it rather than acting on the session; its right-click, which is its menu; and its middle-click, which is its button.
The clock, which opens nothing, has its place in the menu too ([decided 2026-10-27](../decisions/0116-the-clock-has-its-place-in-the-menu.md)): Scheduled, a submenu of its tasks in the clock's own words, as lines to read rather than items to press (`clockLines`).

**What the session is comes first**: a header that is not an item (`MenuItem.header`) — its title, project · group, each state it is in on a line of its own with its dot, its set-aside mark, last activity · model, when it was finished, worktree, the first line of its note, and why it cannot run — drawn from the helpers its row uses (`sessions/describe.ts`), since the tab and a panel's row show little of it themselves.
The states are what its tab says, then its status as its hooks last reported it and its needs-you reasons, in the strength order, the one its dot shows first (`statusLines`, `stateLines`, [decided 2026-11-06](../decisions/0174-a-dots-tooltip-lists-every-state-the-session-is-in.md)): its one dot shows only that one (`dotStatus`), so a session ready and needing you says both here, and the read mark dims the line of the state the dot shows ([decided 2026-10-28](../decisions/0132-the-menu-header-lists-each-state.md)).
Every menu is capped at 300px (`popover.css`): the first line, the session's name, stays one line, cut when too long and carrying its whole text as its tooltip; the lines under it wrap, a path too long for a line breaking wherever the line runs out ([decided 2026-10-27](../decisions/0115-menus-are-capped-at-300px.md)).

**One order on every surface**: Open, Show in list, Fork, Siblings, PRs, Worktrees and Scheduled; Pin in list, Mark as read, Clear needs you, Set aside… and Clear set aside, the note, Move to group and Copy id; a rule; then Stop session, Close tab and Finished.
An item that applies but cannot be taken now stays, unavailable with its reason, as Close tab does with no tab ("Not open in a tab"), since a menu that changes shape is one you have to read again.
One that would be the surface itself is left out — Show in list on the row, Open on a tab that is running, starting or stopping.
**Open** is what a press on the surface does: on the row it opens the tab where you are, on a panel's row it takes you to it, and on a cold tab it starts it.
**Show in list** widens the list to All when it shows another project, rather than choosing the session's project ([decided 2026-10-19](../decisions/0085-show-in-list-widens-to-all.md)).
Choosing a project moves the tab bar and the tab on show with it, while All holds every tab, so the one on show stays.
A filter that still leaves the row out says so in a toast.
**Pin in list** says where its effect is, on every surface, since the tab bar does not honour a pin; once pinned, the item is Unpin.
**Mark as read** and the dot share one rule (`canMarkRead`): only a ready or a waiting session that is not finished has something to mark, so only then is its dot a control, painted and pressable, and the item available, and a click on any other dot is the click of what holds it ([decided 2026-10-19](../decisions/0086-the-dot-and-mark-as-read-share-one-rule.md)).
**Stop session, Close tab and Finished each do one thing, whatever that takes** ([decided 2026-10-28](../decisions/0125-each-leave-item-does-one-thing.md)), by one rule (`leaveAction`, `rules/claude.ts`) that the tab's button is a shortcut to: Stop session ends claude and keeps the tab, Close tab ends it if it runs and closes the tab, and Finished does that and marks the session finished, each waiting out what claude asks on its way out.
Stop session is unavailable on a cold tab ("Not running"), and every item while a tab starts ("Starting…").
While claude is on its way out, the item of what was asked is its force from the ask on, named for it — Force stop, Force close, Force finish — unavailable for the first second and again once forced, so the menu names what was asked before the force can act.
The other items change what the exit does and ask claude nothing more, since a second pair of presses ends what it asks on its way out unanswered: Stop session turns a close or a finish back into a stop that keeps the tab, and Close tab and Finished turn a leave into theirs.
The force's first second runs from the ask, so an item pressed later, over a leave already past it, is its force at once.
An item does what it says or nothing: a press carries the mark it was drawn with and acts only while the item would still do the same (`pressLeave`), all but Finished on a session with no tab, which acts on what is there at the press ([decided 2026-10-21](../decisions/0094-a-menu-item-does-what-it-says-or-nothing.md)).
A list panel's kebab item asks for its action the same way, only while its row still offers it ([§ Types from the config folder](panels.md#types-from-the-config-folder)); the tab's button and its middle-click are drawn from the tab as it is at the press, and go through the same check.

**Finished is one press, and the mark waits for claude to go** ([decided 2026-10-28](../decisions/0126-finished-is-one-press-and-waits-for-claude.md); `finishSessions`, `claude/closing.ts`).
A running session's claude is asked to leave as a close asks it, and its tab stays, stopping, so a question claude asks on its way out is answered in a tab that is still there; its exit removes the tab and marks the session finished (`onExit: 'finish'`).
A tab that is open but not running closes as the session is marked finished, at once.
The mark is written at the exit, so the claudes the app asked do not run a finished session, and one opened in the moment main writes the mark is asked to leave after it, or closed at its exit if it was leaving already, or ended as it arrives if it is still starting.
A claude already on its way out, from a stop or a close, is asked nothing more, since a second pair of presses ends its question unanswered: Finished changes what its exit does, as Close does, and its force is Force finish.
Going on working meanwhile, a prompt or a `/resume` or `/clear`, calls the finish off with the stop, so a session you went on working in is not finished, and nor is the one a `/resume` or `/clear` put in the tab.
A prompt that calls it off says so in a toast, naming the session ([decided 2026-10-28](../decisions/0117-a-called-off-finish-says-so.md)).
A `/resume` or `/clear` says nothing of the call-off, and one into a session another tab runs already says that it runs there ([decided 2026-10-28](../decisions/0122-a-resume-or-clear-call-off-says-nothing.md)).
A write main refuses says so in a toast too, since at an exit the tab has gone and the row staying would be all that says it.
Finished is unavailable while a tab starts ("Starting…"), as Stop session is, since there is no claude yet to ask.
A quit before claude has gone marks nothing finished, and the tab comes back at the next launch, as a close under way does ([decided 2026-10-28](../decisions/0121-a-quit-marks-nothing-finished.md)).

**A close or a finish you press offers Undo** ([decided 2026-10-28](../decisions/0118-a-close-or-finish-offers-undo.md); `offerUndoClose`, `offerUndoFinish`, `claude/closing.ts`).
The toast comes once the tab has gone, for a running session when claude has left and for a finish when its mark is written, so it never offers to bring back a tab that is still there; a tab claude's own exit closed offers nothing, since nobody removed it.
Undo puts each tab back where it stood, if the tabs have not changed since, the one that was on show as it went back on show, a set aside's too, and starts claude again, resuming its conversation where it has one, in each one whose claude the close or the finish asked to leave, unless `undoRunning` is `"cold"` or the session's folder has gone; a tab that was cold, or whose claude a stop had asked to leave before the close or the finish took its exit over, comes back cold ([decided 2026-11-11](../decisions/0211-undo-starts-claude-again-where-it-was-running.md)); a finish's Undo makes the session unfinished first, with its set-aside and needs-you marks as they were, which the finish keeps for it, since a session finished without a tab has no tab to carry them back.
A session opened again meanwhile keeps the tab it has rather than gaining a second, and a finished one gets none; a tab a finish closed, one opened while its mark was written, offers no close of its own, the finish's toast being its Undo.
A close pressed over a finish under way leaves no mark, so the tabs that finish had already removed come back with the close's Undo.
A toast with a button stays 8 s, held from when the pointer moves onto it, where a plain one goes after 3 s, since it has to be read and then reached for; the bar holds one toast, so the next one replaces it, and closing several tabs in a row leaves the last to go undoable, until another toast replaces it.

**A close's toast also offers Finished and Set aside…** ([decided 2026-11-05](../decisions/0166-a-close-offers-finished-and-set-aside.md); `offerUndoClose`).
Every close that offers Undo offers both, for the sessions it closed: one toast for a batch, as the bar's Close tab raises, and a running tab's own at its exit; claude's own exit offers nothing still, and measured on this machine since 2026-10-27, it never happened.
Finished is the menu's (`finishSessions`), handed the tabs the close removed, so its toast's Undo makes the sessions unfinished and puts the tabs back, as a finish's Undo does for the tabs it closed.
Set aside… is the bar's (`setAside`, an ask the session list answers with the dialog `askSetAside` opens), so one session's dialog holds its note and several have no line; its toast is any set aside's (`setAsideTabs`), whose Undo takes the marks off and puts the tabs back, and Cancel brings the close's toast back with its Undo.
A close of one tab of a session already set aside says until when, "Closed "<title>", set aside until Fri 6 Nov, 09:00", or ", set aside, whenever", and any close of such a session offers Clear set aside as a fourth button ([decided 2026-11-11](../decisions/0212-setting-a-running-session-aside-stops-it.md)).
So whichever is pressed, the toast after it goes back to before the close; the close's own Undo goes with the toast it was on, since the bar holds one.
It stays 8 s, held while the pointer is on it, as any toast with a button; its buttons never wrap, and a long title wraps beside them.

**Every way the app opens a session refuses a finished one** (`unopenableReason`, `state/views.ts`): the asks that open a session refuse it with a toast, a finished sibling in the menu is unavailable and says why, and a tab kept for one is dropped at launch ([decided 2026-11-05](../decisions/0167-a-finished-session-is-never-opened.md)).
Its menu, the same on every surface but for its row's Select… ([§ Selecting several](session-list.md#selecting-several)), holds its siblings, PRs, worktrees, scheduled tasks and note, as its row's marks reach them, its id, Unfinished and Delete, and nothing that starts or files it; its dot is never a control.

**A heading's menu holds the ways to start a session there** ([decided 2026-10-20](../decisions/0090-a-headings-menu-starts-sessions-there.md)): New session and New worktree session…, from one function (`newSessionItems`, `sessions/controls.ts`) that the "+"'s caret draws too, so the dropdown and the two menus cannot drift; on a project also New session in group, a submenu of every group the project has (`projectGroups` reads no filter), which reaches a group a filter left without a heading, or unavailable saying why when the project has no groups or its folder is gone.
A project's menu also has **Jump to group**, the heading's jump button as an item, from the one list both draw (`jumpItems`, `sessions/headings.ts`); the button is left out below two places to go, for the room on the heading, while the item stays, unavailable and saying why.
**The order** ([decided 2026-10-20](../decisions/0093-the-order-of-a-headings-menu.md)): the creating items first, together, New group… with them on a project; then the heading's own items; then, on a project, Jump to group; and the moves last of all (`withMoves`), each block below a rule.
The caret is on every heading, and the worktree item is unavailable outside a git repository ("Not a git repository", [decided 2026-10-20](../decisions/0092-the-new-session-caret-is-on-every-heading.md)); where the project's folder is gone, the caret is unavailable as the "+" is, and both items in the menus with the project's gone reason.
Whether a project is a git repository is a fact about its folder, so every session the app knows there answers it (`buildProjectTree`'s `known`), not only the ones a filter shows ([decided 2026-10-20](../decisions/0089-a-git-repository-is-a-fact-about-its-folder.md)): git can file a session's folder as no repository for the rest of a run when it took too long there; a session started at the repository's root then still sits under the project, and the project's other sessions, its worktree ones among them, say the folder is a repository.
The completeness check covers every button on the two headings, in the state its fixture sets up: the "+", its caret and the project's jump button; a press on a heading, which folds it, has no item.

**A press that asks to see the list brings it into view; following a session keeps it in step** ([decided 2026-11-08](../decisions/0189-a-press-to-see-the-list-brings-it-into-view.md)).
Show in list, a click on the tab on show while the keyboard is in its terminal (the `showInList` ask), the tab bar's project and group names and a terminal panel's project names first bring the list into view (`PanelHost.bringIntoView`, [§ Full screen](panels.md#full-screen)): its group unfolded, the list shown in its group, another panel's full screen left; then they land where they point.
Following a session (the `followSession` ask: a tab's click, opening a session from a panel, a toast or a sibling, and a tab's claude moving to a session another tab runs) unfolds only inside the list and never touches the layout, so a folded sidebar stays folded while you switch tabs.
A follow made while the list is out of sight, where nothing can be scrolled, lands on its row once the list takes up room again (`following` in `sessions/reveal.ts`).
The tab's click counts only with the keyboard already in that tab's terminal, read at the press since the press takes the focus away, and never as the second press of a double-click: any other click on a tab gives its terminal the keyboard once it runs, which is a click's job too, and the tab on show's tooltip says "Click again to show it in the session list", where a tab whose folder is gone says why instead.

### A session whose folder is gone

A session cannot run anywhere but its own directory, so when that directory is missing the app **refuses**, in two layers.

The launcher refuses the spawn outright ([decided 2026-09-22](../decisions/0007-the-launcher-refuses-a-missing-folder.md)).
That is the backstop, and it is deliberately below the UI, so nothing can reach a spawn by another route.

Above it, the session list carries two facts per session: whether its **own** directory exists and whether its **project's** does.
They are separate because a removed worktree leaves its repo perfectly usable, while a removed repo takes its worktrees with it — and the wording differs for the same reason.
A missing worktree names the tree to recreate, since `git worktree add` at the same path brings the session back; a missing project has nothing smaller to point at.
Both are re-derived on every listing rather than cached beside the summary: a folder can be removed or put back without the transcript changing, and one stat per distinct path covers hundreds of sessions.

What that buys is a row that says so before you click it.
A session whose folder is gone is dimmed and unclickable with the reason in its tooltip, its **Open** and **Fork** items stay in the kebab but dimmed and inert, and the "+" on a project whose root is gone is unavailable with the same explanation.
Its tab, if it has one, is dimmed by the same rule with the same tooltip, and that is what tells it apart from a cold tab: cold is unfilled and resumes on a click, dimmed will not start at all.
The tab still selects on a click, since the pane is where the reason is said in full.
An action that cannot be taken is shown rather than removed: a menu that changes shape has to be re-read, and an item that vanishes looks like it was never there, where a dimmed one answers the question you opened the menu to ask.

**Unavailable is `aria-disabled`, never the `disabled` property**, and the reason is the tooltip, which shows on keyboard focus as well as on hover ([decided 2026-09-22](../decisions/0009-unavailable-is-aria-disabled.md)).
`setUnavailable()` marks a control and carries the reason; the click handler refuses with `unavailable()`, which is the trade for a tooltip that works.
The one `disabled` left is a row's pin for the moment its toggle is saved, which has no reason to give.
**Management stays**: pin, note, finish and delete all keep working, because cleaning up after a folder that has gone is exactly when you need them.
One function produces that sentence and the tooltip, the toast and the pane all use it, so they cannot drift.

**A project whose folder is gone is marked wherever it is named**, not only through its rows: its heading, the switcher's entries and title, and the tab bar's project label.
The name is muted and the crossed-out folder — the "folder gone" filter's own mark — sits beside it, with the reason as the tooltip.
The heading swaps its folder icon for it, since it already has one in front of the name; everywhere else it comes after the name, so a dead project's name lines up with the rest.
The tab bar's project labels are in full text colour like the headings ([decided 2026-09-28](../decisions/0025-tab-bar-project-labels-are-full-colour.md)); a group's label under its project is told apart by its rail and its lighter weight instead.
Muted rather than dimmed, because the project is not disabled: it can still be folded, selected, renamed and cleaned up, and selecting it is how you get to its sessions to do that.
Scoped to it, the empty pane says the same sentence instead of pointing at sessions or tabs that cannot open.
One rule decides it (`projectRootExists`, which the list's headings and the switcher's model both call), one function says it (`projectGoneReason`, shaped like the session one), and one helper draws it (`markProjectGone`).
It is marked rather than hidden ([decided 2026-09-28](../decisions/0021-a-gone-project-is-marked-not-hidden.md)), and leaves the switcher with the last of its sessions.
Nor does it move: a dead project keeps the place you gave it, since a project that sank to the end whenever a drive was unmounted would move a list under the person reading it.
Group headings and the panels are left alone on purpose: the project heading above a group is sticky, so its mark is on screen the whole time; and a panel already refuses a folder that is not there, in words about its own folder.

Two cases no amount of gating can pre-empt — a folder that disappears while the app is running, and a tab you are already sitting on — which is why the refusal still has to explain itself when it happens.
A tab is kept, cold, rather than closed: the click meant "look at this", and the folder may come back.

`claude -w` also `git worktree lock`s the tree it cuts.
Answering Keep on the way out releases the lock, but a session ended by `SIGTERM`, or one that leaves without answering, leaves it behind, and a later `git worktree remove` refuses until that lock of a dead pid is cleared.
