# Changelog

What changed in each release, for people running a build rather than the source.
The version you are running is in the window title.

Entries are grouped as Added, Changed and Fixed, following [Keep a Changelog](https://keepachangelog.com).
Anything you have to DO when upgrading is in [UPGRADING.md](UPGRADING.md) instead, so this file stays a list of what changed.

## Unreleased

### Added

- A filter for sessions whose folder is gone, next to the other filter pills — the set to clean up, or to put folders back for.
- A config folder for the files you may edit or share, `config/` inside the app's data directory, holding your `settings.json`, the layout file `layouts/default.json` and the scripts it points at; the app reads and watches it, and Settings shows where it is with an Open button.
  Its files are JSON that may also carry comments and trailing commas.
  The app writes only its own files there, whose names end in `.local.json`, never one of yours.
- A layout that arranges the whole window, from that file: rows and columns of panels with the sidebar and the terminal among them, sized in shares or pixels and resized from dividers, where a double-click puts back the file's sizes.
  A mistake in the file is named where it is instead of dropped, and no file can leave you without the terminal; without a file, the window is as it was.
  The sizes you drag to, the groups you fold and the panel you pick are kept in `layouts/default.local.json` beside it, in the file's own field names, so keeping one for good is moving it into your file.
- A `command` panel type: a command line or a script, run in the active tab's folder (or the selected project's) and shown as plain text, run again when you switch project or tab or press Refresh.
  A `cwd` option runs it in a fixed folder instead, whatever is selected, or in a subfolder of the project.
  An `interval` option runs it again on its own, out of sight too, leaving what it last printed on show until the new run ends.
- A `terminal` panel type: plain shells, as tabs in the panel's header, each started where you are working when you make it with `+`, and staying there when you switch tab or project.
  The tabs are the selected project's, All shows every project's in a row each, which fold to one, and a switch ends no shell.
  A tab renames, restarts in the current folder or closes from its menu, and closing or restarting a shell with a command running in it asks first, naming the command.
  After a shell exits, any key starts a new one.
  The tabs come back at the next launch, and each shell starts again when its tab is shown, in the folder it was in when the app quit, on Linux.
  It takes the same `cwd`, and a `scope` to show the same tabs in every project, which a fixed `cwd` does unless told otherwise.
- Several panels in one group, switched from a strip of icons whose dot says a command failed or a session is waiting for you; a panel out of sight keeps what it was doing and runs again only once shown, or on its interval.
- Folding a group of panels to its strip of icons, from a chevron on the divider beside it or by clicking the icon of the panel on show.
  `folded` in the layout file starts a group folded.
- Clicking a group's name in the tab bar takes the session list to that group, as a project's name already does; either one flashes the heading it lands on.
- A new, empty group from a project's options; a group used to need a session to start from.
- A log file, one per launch and day, to send along when something goes wrong: Settings shows its folder with an Open button, and the log of a launch that crashed is kept for longer.
- A history of each session, laid out as claude shows it: every request with claude's messages and tool calls in order, a run of tool calls folded to one line you can open, and a subagent's report the same way, from the start of the session and across compactions.
  It slides in over two-thirds of the terminal from the bar beside it or with Ctrl+Shift+↑, steps with Ctrl+Shift+↑ and ↓, and goes back to claude with Back to live, Esc, or a click on claude beside it; each tab keeps its history open where you left it.
- A bar beside the terminal marking every request, reply and pin, and lighting what is in view; pressing on it opens the history at that point and holding the button scrolls it with the pointer, and hovering it opens a list that the wheel steps through one entry at a time.
- Pinning a request or one of claude's messages in the history, with its star; the pin lasts, and shows in both sessions of a fork.
- Panel types of your own: a folder under `panel-types/` in the config folder, with a `panel.json` and a script that prints a list, is a type of that name, drawn with links, sections that fold and a count on its icon, and run again on an interval even out of sight.
- A row of such a panel can start a Claude session with a first prompt, in the project and group you pick in the app's own dialog, which shows what would start before anything does.
- Such a row then shows its session's status dot and goes to that session when pressed, and pressing its action again offers to continue that session rather than start another.
- A choice in Settings for the sessions that were running when the app closed: their tabs come back paused at the next launch, or start again, or wait for a click with the other tabs, as before.
  It is `runningSessionsAtLaunch` in `settings.json`, `"pause"`, `"start"` or `"leave"`, and paused until you choose otherwise.
- A panel's run can say when it runs next: a line such as `next=5m` in the file `CLAUDE_UI_CONTROL` names runs it again that long after, from `10s` to `24h`, in place of its `interval` or without one.
  `next=off` leaves it until something else runs it, and a `command` panel and a type of your own read it alike.
- A `watch` option, `"watch": "git"`, runs a panel again when the git working tree of its folder changes, looked at every 30 seconds, out of sight too, once a burst of changes has settled.
  A folder in no working tree says so in the panel's place, and when git cannot answer the panel's check it asks again three times, then waits until something looks again, such as Refresh.
- Pausing a tab, from its session's menu, to set it aside without keeping it running: claude is asked to leave, as a stop asks it, and the tab stays, its dot showing two bars, until you open it again or choose Stop session, which leaves it an ordinary stopped tab.
  A paused tab comes back paused at the next launch and does not start.
- The live strip lists paused tabs beside the running sessions, in their place in tab order, so it also comes up at launch when a paused tab comes back.
  Its line counts them apart, such as `2 live · 1 paused`, and a paused row's button closes its tab.
- Each row of the live strip has its session's menu, the one its row in the session list has, so a session in another project can be paused, or a paused one stopped, from where you are.
- Each tab has its session's menu too, from a kebab beside its button or a right-click on the tab.
  Every tab is 12px wider to make room for the kebab, so a long title shows as much as before.
- A row of a panel type of your own can show a tooltip on its first line, from a `tooltip` the script gives it, such as all of what that line shortens.
- A session whose turn has ended while work it started still runs, such as a shell, a monitor or a subagent left in the background, says so on its dot instead of showing finished, and the dot's tooltip names that work, as in "Working in the background: 1 shell".
  It shows finished once that work has finished on its own and claude has answered it, and says it is waiting for you only a minute after that, rather than a minute after the turn that started the work.
- A `positive` tone for a row of a panel type of your own, which marks its leading edge green.
- A row of a panel type of your own can carry a short mark before its text, `lead`, coloured by a tone of its own, and a short text at the end of its first line, `trail`, such as a count.
- A list of a panel type of your own can be compact, with `"compact": true` in what its script prints: its rows lose the card around each, and a row's text keeps to one line.
- A row of a panel type of your own can have its text cut short at its start, with `"cut": "start"`, so a long path keeps its end, such as its file name, in view; such a row keeps to one line.
- A row of a panel type of your own can hold rows of its own, `children`, which it folds away and back from a chevron, as a file tree folds a folder; a section's count counts the rows that hold none.
- A list of a panel type of your own can offer several views, such as flat and as a tree, with `views`: the panel's header then switches between them, the script is told which with `CLAUDE_UI_VIEW`, and a panel entry's `view` in the layout says which it shows until you pick another.
  The view you pick is kept for the panel on this machine.
- A section of a panel type of your own can show a tooltip on its heading, from a `tooltip` the script gives it, such as all of what its title shortens.
- A session's PRs, as Claude Code links them in its transcript: a mark on the session's row counts them and lists them, the session's options list them too, on its row, its tab and the live strip, and each opens its page in the browser.
  A filter shows only the sessions that link one, and searching for a PR's number finds the session that linked it.
- A row of a panel type of your own can have several lines under its first, `detail`, each made of parts with a separator between them, ` · ` unless the list or the row names another.
  A part can be a link of its own, which opens in the browser instead of the row's, show a tooltip, and take a tone.
- A panel type of your own can declare an option whose value is a list, `"kind": "list"`, of texts or of objects of the `fields` it declares, such as several buttons, each with its own word and prompt.
  Its script gets the list as JSON.
- A row of a panel type of your own shows its first action as a button and the rest in a menu behind a ⋮ at its end, and a list's `buttons` says how many show as buttons.
- A filter for paused sessions, beside the live one.
- Hiding a project from the live strip, from the eye on its heading: its sessions leave the strip, and a Hidden line at its foot counts the hidden projects and still shows what they are asking of you.
  It stays hidden across a restart, and comes back when you pick it from that line's menu, or open or start a session in it.
- Folding the tab bar to one row, from a chevron on the line under the tabs, as a group of panels folds from its divider, to give the terminal the room: the row of the tab on show stays, or the first row when no tab is on show, and while a tab folded away is waiting for you, or has finished and is not marked read, the chevron turns into its status dot.
  It stays folded across a restart.
- A session's options, on its row, its tab and the live strip, open with what the session is: its title, project, group and status, when it was last active and on what model, when it was archived, its worktree, the start of its note, and why it can't run when its folder is gone.
- A session's options now hold the actions you could only take from its row, tab or strip row, so a session can be dealt with from wherever it is listed: Open, Show in list, Pin in list, Mark as read, and the tab's Stop session, Force stop or Close tab.
  Show in list from a tab or the strip widens the list to All when it shows another project, so the tab you are in stays on show.
- A session in the archived view has options too: what it is, its siblings, PRs and note, its id, Unarchive and Delete.
- A project's and a group's options start a session there, New session and New worktree session…, and a project's has New session in group, which reaches a group the filter hides as well, and Jump to group, to the places its heading's jump button offers.

### Changed

- A session stopped before you had sent it anything comes back as the same session when you start it again, keeping its pin, note and group, instead of returning as a new one.
- The filter button is a funnel instead of a magnifier: closing its panel keeps the filter on, which is not what a search box does.
- Icons in the sidebar and tab bar share one line weight.
- Closing the filter panel while a filter is on leaves a row showing what is on — the search text, each filter, the date range — each with its own ×, above the count and Clear; press the row to open the panel again.
- Every scrollbar is the thin dark one the session list and the terminal already had, including the project switcher, the live strip and panels, instead of the system's light one.
- A project whose folder is gone is marked in the project switcher, on its heading and in the tab bar, with a crossed-out folder and a muted name, instead of only in its sessions' rows.
- Project names in the tab bar are in full text colour, as their headings in the session list are.
- A tab whose session's folder is gone is dimmed like its row, with the reason on hover, instead of looking like a tab you can resume.
- Making a group from a session's options takes the list to the new group at the top of its project, instead of leaving the session to move out of sight.
- A tab that isn't running says so with a Resume button and a Show history button, instead of asking you to click its tab.
- Starting a session in another project while you are in a project view takes the session list to All at its top, as choosing All does, instead of keeping the previous project's scroll position.
- The default launch flags are kept in the config folder, in `settings.local.json`, where Settings saves them and where the ones you had set move by themselves.
  A `settings.json` of your own beside it can set them too; what Settings saves wins, and Settings shows yours with a button to go back to them.
- Ctrl-C twice in a session's terminal goes to claude, as in any terminal: from its prompt claude exits, or first asks what it has to, and the tab closes when it has gone.
  The app used to close the tab itself on the second press.
- The live strip marks the session whose tab you are looking at, as the tab bar and the session list already do.
- Every kebab is narrower, its box hugging its three dots, so its dots sit closer to the control beside it; a session row's title, outside the archived view, gets 12px more room.
- A borderless icon button, such as a kebab, the pin or a tab's close, turns accent blue on hover instead of filling with an outline; a bordered one, such as the + beside a project, fills as before.
- A project whose sessions are all archived stays in the session list and the project switcher, saying so under its name, instead of disappearing, and archiving the last session of the project you are in keeps you there.
  Deleting its sessions takes it away.
- Changing a filter opens every section again, where a fold made under the filter used to last until the filter was cleared, and could hide a new match.
- Collapse-all and a project's group jump work while a filter is on, folding and opening what the filter shows.
- Archive is unavailable while a session runs: stop it first, so anything claude asks on its way out is answered in its tab.
  Archiving a session whose tab is open but not running closes the tab.
- The app no longer opens an archived session again: an archived sibling in a session's options says it is archived, and a tab left open for one does not come back at the next launch.
- A session's status dot reacts to a click only while the session is idle or waiting for you, when a click marks it read; any other dot no longer looks clickable, and a click on it does what a click beside it does.
- The arrow beside a project's or a group's + is there outside a git repository too, its New worktree session… greyed out saying why, where the arrow used to be missing.
  A project's and a group's options open with the ways to add something there, on a project New group… among them, and end with the moves, Move to top, up, down and bottom, where it has any, which used to come first.

### Fixed

- A session you `/clear` stays in the group it was in, instead of the tab dropping out of its section.
- Compacting a session shows it as busy while it runs and idle when it finishes, instead of leaving the dot on whatever it said before.
- Entering or leaving a worktree, and gaining a sibling, show up in the session list when they happen instead of waiting for some unrelated change.
- Stopping a session now ends it.
  It was asked once, with a signal it was free to ignore, and the session could keep running while the app showed it as stopped — including the sessions left behind when you quit the app.
- Switching model with `/model` updates the model shown in the session list straight away, instead of only once that model had answered something.
- The live strip keeps still.
  It follows your tabs now, so a row only moves when you drag, open, close or regroup a tab — rows used to swap places whenever one of them wrote a message.
  Pinned sessions no longer float to the top of it.
- Closing a live session's tab takes it out of the live strip at once, instead of a moment later.
- The tab bar puts projects in the order you set, like the session list and the live strip.
  It used to order them by whichever project you happened to open a tab for first, which moved on its own as tabs came and went.
- A session whose folder no longer exists says so instead of quietly starting in your home directory and moving itself there in the list.
  Such a session is dimmed and can't be opened or forked, and a project whose folder is gone can't start new sessions — with the reason on hover.
  Pinning, notes, archiving and deleting still work, and a session comes back to life if you put its folder back (for a worktree, recreate it at the same path).
- Screen readers announce the filter button by name; it had none.
- The filter count's total is what you are filtering — the selected project's sessions, and in the archived view its archived ones — instead of every session in every project, archived included.
- A group's icon in the tab bar is muted again, as it is in the session list.
- A menu opened near the bottom of the window opens upward, instead of running off the edge.
- With the open or live filter on, the session list follows your tabs as they open, start, stop and close, instead of waiting for something else to redraw it.
- When the project you are in has no sessions left, the tab bar goes back to All along with the list and the switcher, instead of staying empty.
- Closing the tab of a new session that never wrote anything takes its row out of the list, instead of leaving it there until something else redraws the list.
- When your last session is gone, the empty terminal area tells you to start one with + New, instead of pointing at a session list with nothing left to pick.
- The project heading's new-session caret keeps its hover look while its menu is open, as every other menu button does, instead of changing colour as you move onto the menu.
- In a project, once you have folded each of its groups by hand, the collapse-all button offers to expand them, instead of still offering to collapse them.
- Clicking the notification for a session that is waiting for you or has finished also shows its row in the session list, unfolding its group, as a click in the live strip does.
- A session that has left its worktree keeps its worktree badge, which it used to lose as soon as it left.
  The badge is muted then, its tooltip says whether the session was closed in the worktree or moved out of it, and where it runs now, and the worktree filter still finds it.
- Stopping a session or closing its tab leaves anything claude asks on its way out in its tab to answer, such as whether to keep a worktree with changes, instead of ending the session over the question.
  The tab stays until claude has gone, and for a session that has not gone a second later the stop button becomes a force stop.
- Quitting the app, or forcing a stop, gives a session three seconds to finish leaving before it is killed, instead of just over one.
- A tab whose session failed to start closes with one press of its button, and the live strip no longer lists it as running; selecting it tries the start again, as selecting a stopped tab does.
  Its button used to send a stop nothing answered, so it never closed the tab.
- On macOS, closing the window ends its sessions as quitting does, instead of leaving them running out of any window's reach until the app quit.
- A click in the session list, the live strip, the project switcher, the tab bar or a list panel counts when it changes at the same moment, unless the change moves what you clicked, and a button there you reached with the keyboard keeps the focus; both used to be lost.
- A tab dragged while the tab bar changes, such as an open tab's session changing status, still moves where you drop it, instead of staying where it was.
- A session you had to force to stop no longer goes on showing busy or waiting, on its own dot and on its project's in the switcher.
- A session title with a word too long for its row, such as a link, wraps as the rest of the title does instead of being cut off where the row's buttons begin.
- A subagent still working after its session's turn has ended no longer turns the finished session's dot back to busy.
- A session's dot no longer stays busy after Ctrl+C or Esc interrupts its turn, or waiting after Esc turns down a permission prompt: it shows finished, or working in the background while work from an earlier turn, or a shell, a monitor or a subagent the interrupted turn started, still runs.
- A session's dot no longer stays on working in the background after you stop a shell or a monitor from claude's own task list.
- A session's dot shows waiting as soon as claude asks for permission, instead of about six seconds later, or not at all for a prompt you answered within those seconds.
- A session's dot shows claude working again a second or so after you turn a prompt down with feedback, instead of waiting until its next tool had run or its turn ended.
- On macOS, the folder picker behind + New shows hidden folders as well.
- Every ⋮ button has a name a screen reader says, the one its tooltip shows, such as "Session options".
- The point on a menu's edge no longer cuts into the item beside it when that item is highlighted, such as All in the project switcher.
- Moving a project up or down always passes the next project in the list, where a new project's first move down sometimes did nothing.
- The sidebar's header buttons, + New included, all hover alike, and Filter, + New and Settings show an open look, distinct from their hover, while what they opened is up, where the filter's used to be its hover and Settings showed nothing.
- A panel's icon in a strip of icons, and a view in a panel's header, fill under the pointer as a tab you are not on does, instead of turning blue.
- A click on a tab counts when the pointer moves a pixel or two during it, instead of starting a drag and leaving the tab unchosen.
- A button that can't act for the moment, such as a tab's while its session starts, can be reached with the keyboard to read why, instead of being skipped.
- On macOS, the folder picker behind + New can make a new folder.
- A session that published an artifact no longer stays on working in the background: claude watching the artifact for comments is not counted as work.
- A session you go on in with claude's own `/resume` inside a tab keeps its title and its group, instead of being taken for a cleared one: a blank title, and moved into the group of the session the tab ran before.
  An archived session resumed that way is unarchived, and a message says so.
- A session you go on in with claude's own `/resume` while another tab runs it is handed back: that claude is stopped, its tab stays on the session it was on, and the tab running the session comes on show, since two claudes in one session branch it, and a later resume shows only one of their turns.
  A tab that only held the session, with nothing running, closes instead.

## 0.3.0 — 2026-08-29

### Added

- A filter for sessions carrying a note.
- A settings screen, behind the gear in the sidebar header.
  It holds default launch flags for now: set `--allowedTools Grep,Glob` once instead of typing it per session.
  Flags the app sets for itself are refused with a reason, and a change applies to sessions started from then on.
- Mute or stop a session from the live strip, without leaving the project you are looking at.

### Changed

- The app reopens the way you left it: the window's size and position, and the sidebar's search, filters, date range, folds, width and scroll offset.
- The filter panel reopens as you left it, with whatever filter was on still applied.
- Folding a project or group while a filter is on lasts as long as the filter and leaves your usual folds alone underneath.
- A tab's button takes two presses: the first stops the session and leaves the tab cold and resumable, the second removes the tab.
  A cold tab still goes in one press.
- The strip is gone entirely when nothing is running, rather than saying "All clear" with a caret that could not open.
  It comes back the way you left it.
- The live strip lists what is running, wherever it is running, rather than only what is nudging.
  Marking a dot read no longer removes its row, its label counts what actually wants you ("2 of 5 need you"), and a session in a group carries that group's name.
- The strip follows the sidebar's order — your project order, pins floated — instead of reshuffling itself on every status change.
- A session with a `claude` behind it is called LIVE, not running — "running" read as a state like busy rather than as the difference between a session and a tab.
- A session that has just started, before it reports anything, shows as a quiet ring in the strip instead of an empty gap.
- The button that acts in a dialog — Save, or Delete — is filled rather than outlined, so it is the one your eye lands on.
- Status dots read as states: "Busy", "Idle", "Waiting for you", and "Not running" for a hollow one, which used to say "closed".

### Fixed

- Deleting a session while its tab was still starting left a `claude` running with nothing pointing at it.
- Projects in the switcher stayed marked when nothing under them wanted you.
- The window no longer drifts down and to the right by one title bar on each launch, and it can no longer be resized down to nothing.
- The pin, the toast close and the notification close grew by two pixels when hovered, while every other icon button held still.

## 0.2.0 — 2026-08-28

Upgrading on macOS needs one manual step this version only — see [UPGRADING.md](UPGRADING.md).

### Changed

- Starting or resuming a session shows that it is starting, instead of a black pane for the couple of seconds claude takes to appear.
- Your pins, groups, notes and open tabs are kept safe across an update: installing a different version keeps a copy of them first, and an older version can no longer discard settings a newer one wrote.

### Fixed

- Closing a tab works on macOS.
  The close button was being swallowed by the drag-to-reorder handling, which only misbehaved there.
- A session no longer stays marked as waiting for you after you answer a permission prompt.
  It goes back to busy as soon as work resumes, rather than at the end of the turn.
- The app icon shows correctly on Linux, in the Start menu and the taskbar.

## 0.1.0 — 2026-08-27

First packaged release.
Until now the app had to be run from source; there are now installable builds for macOS (Apple Silicon) and Linux.
See the README for how to install one, including the extra step macOS needs on first launch.

### Added

- Lists your `~/.claude` sessions grouped by project, with pinning, archiving, notes and custom groups, refreshed as transcripts change on disk.
- Runs several sessions at once in tabs, each an embedded terminal running the real `claude` CLI, with its approval prompts and permission modes intact.
- Shows a per-session cue for busy, idle and waiting-for-you, so a session that needs an answer is visible without opening it.
- Starts new sessions, forks an existing one, and creates sessions in a fresh git worktree.
- Restores your open tabs on launch without starting them; a tab starts when you click it, and can be stopped again while keeping its place.
