# Principles

What claude-ui holds to, and what a change to it is checked against.
Where a feature and a principle disagree, the feature changes, or the principle is rewritten on purpose with its reason; neither is left to drift.
The last section lists where the app falls short of them today.

## Claude Code is the source of truth

The app runs the real `claude` CLI and reads what Claude Code writes; it does not imitate Claude Code, and it keeps no second copy of what Claude Code keeps.

- The app never writes a session or a transcript in `~/.claude`: it reads them, and the one change it makes is deleting a session, which you press, and which moves its files to the system's trash.
  Beyond the sessions, it only creates `~/.claude/projects` when that is missing, and removes the status hooks an older version of the app put in `~/.claude/settings.json`.
- Where Claude Code has a way to do something, the app uses that way: a session it starts gets its id with `--session-id` and its name with `--name`, Claude Code's own flags for them, and the status hooks come in through `--settings`, never added to Claude Code's own settings file.
- What Claude Code keeps nothing for, the app keeps in files of its own: pins, groups, notes, and the marks that say a session needs you or is set aside.
  These add to Claude Code; none of them replaces or shadows something Claude Code already has.
- When Claude Code gains its own way to do something the app does itself, the app moves to it.

## The core is sessions; what belongs to one tool is an extension

The app's own part is the sessions and the general means to organise, follow and extend them: the session list and its groups, the tabs, the terminal, the history, the status cues, the layout and its panels.
What belongs to one tool, service or team habit, such as an issue tracker, a review queue or a team's conventions, is something a user adds, as a panel type of their own, and the app does not ship it.
A need that most users share may ship with the app, as pull requests do, but built so that a user without it loses nothing by switching it off.

## You can shape it

Anything a user may want otherwise is a setting, an option or a panel type of their own, with a default, rather than an answer fixed in the app.

- The layout is a file of yours, and so are the settings, which you edit by hand or in Settings.
- A panel type is a folder you write or copy from a colleague: a script that prints a list, which the app draws in its own look ([Panel types of your own](panel-types.md)).
- The built-in panels, the session list and the terminal area, are placed and sized by the layout, and a few settings shape what they do.
- Something the app ships that a user could have written is written the way a user's would be, so it can be switched off, copied or replaced.

## The app observes; you decide

What the app shows about a session is what it can read or ask: claude's status from its hooks, a PR from Claude Code's own link, a review or comment the session posted on it, or the PR a panel row named when it started the session, and from what GitHub says of it.

- Where something cannot be known reliably, the app says so or shows nothing, rather than a guess: in a folder several sessions share, git knows that a file changed, not which session changed it.
- Finishing, setting aside, grouping and naming are yours: the app can offer them at the moment they are cheap, but never does them on a timer or in a sweep.

## Retire work; do not add it

Every new mark, state or list is weighed by one question: does it take something off your mind, or add one more thing to keep up?
A mark that only accumulates, and goes only when you remember to clear it, makes losing track worse however useful each one looks.
So whatever asks for your attention also says what settles it, and goes once it is settled, as a session's needs-you mark goes once you act on it, such as by typing a prompt there, closing its tab or marking it finished, and not when you only look at it.

## One implementation, one behaviour

Anything that exists on more than one surface is one piece of code with parameters for the real differences, never copies kept in step by hand.
Where the same question is answered on more than one surface, such as what order things are in or what a control does, the answer is the same everywhere, unless a difference was decided and is written down beside the code ([UI conventions](architecture/ui-conventions.md#ui-conventions)).

## No workflow is imposed

The app offers ways of working and prescribes none.

- Sessions run where you start them: side by side in the project's own folder, or in a worktree of their own when you ask for one; the app never makes a worktree per session.
- Nothing assumes a process, such as one story per session, or research, then a plan, then an implementation: a habit like that is yours to build from groups, panel types and settings.

## What is yours stays yours

- The config folder is yours: the app writes only `settings.json`, at the moments [the config folder](guide/layout.md#the-config-folder) lists, and the `.local.json` files beside your own; it never writes your layout or any other file there.
- A panel type you were sent runs as you, so read it before you add it; anything a panel does beyond running its script, such as opening a link or starting a session, is something you press.
- The log records what the app did, not your prompts or conversations, apart from the last few lines a session printed when it failed to start.
- The usage record notes when sessions were finished, set aside or kept, when the review opened and ended, and what marked a session as needing you, as moments, session ids, types and counts, and stays on this machine.

## Failures show

Something that fails says so where it failed, and why, rather than showing nothing, or something empty that looks like an answer.

- A panel whose run fails keeps the list it had under a line saying why, and never shows an empty one.
- A mistake in the layout is named in the panel or group it concerns, and one in the settings under its field in Settings; a file that does not parse is named with the parser's error, and the last one that did stays in use.
- A session whose folder is gone says so, and refuses to start somewhere nobody chose.

## Where the app falls short today

- What GitHub says of a PR is asked by the app itself, not through anything another forge could use as well.
- A panel type draws in its own panel only: it cannot add a mark to a session's row, an item to its menu, or a filter to the session list.
- The built-in panels take no options of their own yet: only the layout and a few settings shape them.
- Which reasons can mark a session as needing you is the app's: `needsYou` in your settings switches off or changes any it keeps, but a reason of your own cannot be added yet, and claude asking or being ready always shows on its dot.
