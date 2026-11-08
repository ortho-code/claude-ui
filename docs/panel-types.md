# Panel types of your own

A folder under `panel-types/` in the config folder is a panel type, named after the folder, which the layout file then uses like any built-in type.
A type is shared by copying its folder, and a type you were sent runs as you, the way a script in `scripts/` does, so read it before you drop it in.
Everything a panel does beyond running its script — opening a link, starting a Claude session — is something you press.

This document is the contract a type is written against: what goes in its folder, what its script is given and prints, and what the app does with it.
A test holds it to the app's own checkers, so a field named here is one the app reads, and one the app reads is named here.

## A type's folder

```
panel-types/commits/
  panel.json     what the type is
  list.mjs       the script it runs
  to-list.mjs    whatever else the script needs
  tests/         its own tests, apart from the code
```

The folder's name is the type's name: lowercase letters, digits, hyphens and underscores, starting with a letter or digit.
A folder named like a built-in type (`sessions`, `claude`, `command`, `terminal`) is not read, and a note under the window says so.

## The manifest

### `panel.json`

One JSON object, which may carry comments (`//` and `/* */`) and trailing commas, as every file in the config folder may.

| Field | Meaning |
|---|---|
| `version` | Required, `1`: the one shape this version of the app reads. |
| `kind` | Required: what kind of panel the type is. |
| `title` | What a panel of the type is called when its layout entry gives no `title`; the entry's id without either. |
| `icon` | Its icon on a strip of icons, by name from the app's set (see the README's Panels section); `list` without one. |
| `run` | Required: the script, a path relative to the type's folder and inside it, and executable. |
| `interval` | How often a panel of the type runs again on its own, as `30s`, `5m` or `1h`, from `10s` to `24h`; only on show and on Refresh without one. |
| `options` | Settings of the type's own, which a layout entry gives under `options` and the script gets as variables. |

`kind` is one of: `list`.
A `list` type's script prints a list, and the app draws it.

### An option

| Field | Meaning |
|---|---|
| `name` | Lowercase letters, digits and underscores, starting with a letter; the script gets it as `CLAUDE_UI_OPTION_<NAME>`. `cwd`, `interval` and `watch` are the kind's own and cannot be declared. |
| `kind` | What the value is. |
| `fields` | For a `list`: what each item holds, each declared as an option is, by `name` and `kind`; an item is then an object of them. A `list` without `fields` holds texts. |

An option's `kind` is one of: `text`, `list`.
A field's `kind` is one of: `text`.

A `text` is a string, and an empty one is a mistake: leave the option out instead.
A `list` is an array, never an empty one, of texts or, with `fields`, of objects of those fields; an object may leave a field out, and the script decides what that means, but a field the list does not declare is a mistake, named by where it is, such as `actions[0].buton`.

<!-- checked: manifest -->
```json
{ "version": 1, "kind": "list", "run": "list.mjs", "options": [{ "name": "actions", "kind": "list", "fields": [{ "name": "button", "kind": "text" }, { "name": "prompt", "kind": "text" }] }] }
```

A mistake in `panel.json` is named where each panel of the type would be, every mistake at once, and the panel does not run.
A field the app does not read is noted and ignored, so a manifest written for a later version still works here.

## In the layout

The layout file uses the type by its name, and its entry's `options` take the type's own and the kind's:

```json
{ "id": "commits", "type": "commits", "options": { "count": "10", "interval": "5m" } }
```

`cwd` is where the script runs: without one, where the active tab's session works, the checkout it last changed a file in, or the selected project's root when no tab is open, which the panel's header names; an absolute path or one under `~/` is fixed, whatever is selected; a relative one is under that same folder, so it follows the project.
A `list` is written as one, here for the `actions` declared above:

```json
{ "id": "stories", "type": "stories", "options": { "actions": [
  { "button": "Research", "prompt": "/research {id}" },
  { "button": "Autopilot", "prompt": "/autopilot {id}" }
] } }
```

`interval` overrides the manifest's.
`"watch": "git"` runs the panel again when the git working tree of the folder it runs in changes, as a `command` panel's does (see the README's Panels section).
`"watch": "sessions"` runs it again when the sessions file (below) would say something else than it said to the last run, once nothing more has changed for 2 seconds.

## What the script is given

It runs through your login shell, the same one your sessions run in, so `PATH` is the same; in the folder `cwd` says; with stdin closed; with `NO_COLOR=1` and `TERM=dumb` set; and with these variables:

### Variables

| Variable | Value |
|---|---|
| `CLAUDE_UI_PROJECT_ROOT` | the selected project's repo root, empty without one |
| `CLAUDE_UI_CWD` | the folder the script runs in |
| `CLAUDE_UI_SESSION_ID` | the active tab's session, empty without one |
| `CLAUDE_UI_CONFIG_ROOT` | the config folder |
| `CLAUDE_UI_OPTION_<NAME>` | each option the entry gives, by its name in capitals: a `text` as it is written, a `list` as JSON, such as `[{"button":"Research","prompt":"/research {id}"}]`, which a script reads with `JSON.parse(process.env.CLAUDE_UI_OPTION_ACTIONS ?? '[]')` |
| `CLAUDE_UI_VIEW` | the view on show, by id, among the list's `views` (below): the one picked in the panel's header or as its layout entry's `view`, else the first; before the panel has printed a list since it was last mounted, the pick as it stands, empty without one; and empty for a list offering no views |
| `CLAUDE_UI_CONTROL` | a file of the run's own, to say when it runs next (below); unset in the rare run whose file could not be made, which the log names |
| `CLAUDE_UI_SESSIONS` | a file of the run's own holding the sessions the app has (below), removed when the run ends; unset in the rare run whose file could not be made, which the log names |

`CLAUDE_UI` itself is not set, so a `claude -p` the script runs is not taken for one of the app's sessions.

What it prints on stdout is the list, and nothing else may be there: what your shell's startup files print never reaches it.
What it writes on stderr is kept, and its last lines are what a failure quotes.
A run that exits other than 0 has failed; so has one still going after 30 seconds, which is stopped, and one printing more than 1 MB in all.

### Saying when it runs next

`CLAUDE_UI_CONTROL` names a file of the run's own, empty when it starts, which the script may write `name=value` lines to; the app reads it when the run ends.
A file rather than a line in what it prints, since that is often somebody else's text, which could carry such a line.

| Name | Meaning |
|---|---|
| `next` | When the panel runs again on its own, counted from this run's end: a duration from `10s` to `24h`, as an `interval` is, for that one run in place of the interval, or without one; or `off`, for no run on its own until something else runs it. |

```sh
# Every minute while the working tree has changes, every hour once it is clean.
if [ -n "$(git status --porcelain)" ]; then echo "next=1m"; else echo "next=1h"; fi >> "${CLAUDE_UI_CONTROL:-/dev/null}"
```

A run that writes nothing leaves the next run to the `interval`.
A `next` under `10s` runs at `10s` and one over `24h` at `24h`, each with a note (`0s`, as in an `interval`, is not a duration); a line that is not `name=value`, a name the app does not read and a last `next` it cannot read are each a note on the group's note line, and none of them is acted on.
Only the last `next` counts, and only the file's first 4 KB is read: an earlier `next` and anything past that are not.

### The sessions

`CLAUDE_UI_SESSIONS` names a file holding one JSON object, `{ "version": 1, "sessions": [...] }`: every session the app has that is not finished or being deleted, a new session's tab included before its transcript is listed, each once and in the order of their ids, as they were when the run started.
It is data, not words: what a reason or a status is called on a row is the type's to say.
A row keeps a session's title and dot current between runs through a live value and its `session` (below), so the file is for choosing the rows.

| Field | Meaning |
|---|---|
| `id` | The session's full id, as a live value, an item's `session` and `open-session` take it. |
| `title` | What the app calls it, as a live value's `title` says it when the run starts. |
| `project` | Its project's folder, the repository's root. |
| `group` | Its group, `{ "id", "name" }`, or `null` for none. |
| `status` | What its claude last said: `busy`, `idle`, `background` (the turn has ended and work it started still runs), `waiting` or `closed`; `null` when it has said nothing, as for a session the app did not start, and once its claude has gone, its tab closed or no longer running, unless its end is reported after that, which is `closed`. |
| `read` | Whether its dot was marked read. |
| `asks` | Whether it asks for you now, by the rule its dot and the project switcher's count follow: claude waiting for you or a finished turn, or a needs-you reason, where that is what its dot shows in the strength order, it is not marked read, and a reason was not put aside by setting the session aside after it. |
| `needsYou` | Why it is marked as needing you, a reason each, and empty when it is not (below). |
| `setAside` | Its set-aside mark, `{ "due", "at" }`: when it comes back as needing you, `null` for whenever, and when it was set, both as epoch milliseconds; `null` when it is not set aside. |
| `prs` | The PRs it links, each `{ "repository", "number", "url", "status" }`, `repository` as `owner/name`; `status` is what GitHub last said of it (below), `null` until GitHub has answered for that PR, which one it cannot be asked about never does. |

A reason in `needsYou` has a `type`, the `category` that type belongs to, and `at`, when it was marked, in epoch milliseconds; `category` is `null` for a type the app has no category for.
The categories are `your-turn`, `back-to-work`, `ready-to-merge`, `look-again`, `reminders` and `finish-up`, in that order.

| `type` | `category` | Meaning |
|---|---|---|
| `app.was-running` | `reminders` | It was running when the app last closed; `how` says how the app closed: `quit`, `ended` without quitting, or `unknown` when the app cannot say. |
| `app.reminder` | `reminders` | The moment it was set aside until has come, and it needed you for nothing else then; `at` is that moment. |
| `pr.checks-failed` | `back-to-work` | A PR it links has failing checks. |
| `pr.conflict` | `back-to-work` | A PR it links conflicts with its base. |
| `pr.changes-requested` | `back-to-work` | A review asked for changes on a PR it links. |
| `pr.approved` | `ready-to-merge` | A PR it links was approved. |
| `pr.reopened` | `look-again` | A closed PR it links was opened again. |
| `pr.new-commits` | `look-again` | A PR it links that you reviewed moved on from the commit your review was on, by new commits or a rebase. |
| `pr.review-requested` | `look-again` | Your review was asked on a PR it links. |
| `pr.merged` | `finish-up` | A PR it links was merged. |
| `pr.closed` | `finish-up` | A PR it links was closed without merging. |

A PR's type names its PR in `pr`, `owner/name#number`.
A PR's type marks a session only for your roles on the PR its file lists (the README's What needs you): as shipped, failing checks, a conflict, changes requested and approved for your own PRs, new commits since your review and your review asked for a PR you review, and the rest for every role.
Several changes found in one look at a PR are a reason each, with the same `at`, such as `pr.checks-failed` and `pr.approved` together; the app names them on one line, "PR #7 checks failed, approved".
Claude asking you something or finishing a turn are types too, `claude.asks` and `claude.finished` in `your-turn`, but they are never in `needsYou`: `status` and `read` say them.

`needsYou` lists every reason, also those a set-aside mark set after them puts aside: the app shows a session as needing you only while a reason's `at` is after its set-aside mark's `at`, or it is not set aside.
A set-aside mark whose moment has passed shows here until the app has turned it into a reminder: at that moment while the machine is awake, and within the hour of waking when it slept through it.

A PR's `status` is `{ "state": "merged", "role" }` or `{ "state": "closed", "role" }`, or for an open one `{ "state": "open", "role", "draft", "review", "checks", "conflict", "approvals", "newCommits", "reviewAsked" }`: `review` is GitHub's review decision, `approved`, `changes-requested`, `review-required` or `null`; `checks` is `passed`, `failed`, `running` or `null` for none; `conflict` is `null` while GitHub is still working it out.
`role` is your role on it, for the login `gh` runs as: `own` for a PR you wrote, `reviewing` for someone else's you submitted a review on or are asked to review, `other` for someone else's with neither.
`approvals` counts the reviewers with write access whose latest review approves; `newCommits` is whether its head moved on from the commit your latest submitted review was on, `false` without such a review; `reviewAsked` is whether a request for your review stands.
Any of these is `null` while not known: GitHub left it out, or the status was kept before the app asked it.
With PR status off in Settings, every `status` is `null`.

## What the script prints

One JSON object:

<!-- checked: list -->
```json
{ "version": 1, "badge": 2,
  "sections": [
    { "empty": "Nothing waiting on you.", "items": [
      { "key": "org/repo#1", "text": "Fix the login redirect", "press": { "open-url": "https://github.com/org/repo/pull/1" }, "tone": "attention",
        "detail": [
          ["#1", "3d", "someone"],
          [{ "text": "Login revamp", "press": { "open-url": "https://example.com/epic/9" }, "tooltip": "Its epic" }, { "text": "blocked", "tone": "danger" }]
        ],
        "actions": [{ "label": "Review", "session": { "prompt": "/review 1", "name": "Review #1", "pr": "https://github.com/org/repo/pull/1" } }] }
    ] },
    { "title": "Blocked", "shut": true, "items": [] }
  ],
  "notes": ["Could not read team membership."] }
```

### The list

| Field | Meaning |
|---|---|
| `version` | Required, `1`. |
| `badge` | A count on the panel's icon and beside its title: a whole number, 0 or more. |
| `views` | The ways the script can print the list, such as flat or as a tree: with two or more, the panel's header shows a switch between them, and a pick runs the script again with it as `CLAUDE_UI_VIEW`. |
| `compact` | `true` draws the rows without the card around each, for a list scanned many rows at a time; a row's text is then cut short to one line, so put the rest in its `tooltip`, and leave out `detail`, whose lines still go under it. |
| `separator` | What goes between the parts of each line of a row's `detail`: ` · ` without one; an empty one sets them side by side. |
| `buttons` | How many of a row's `actions` show as buttons, a whole number, 0 or more: `1` without one, so a row shows its first action as a button and the rest in a menu behind a ⋮ after it; `0` puts every action in the menu. |
| `sections` | Required: the sections, in order. |
| `notes` | Sentences for the line under the panel. |

### A view

| Field | Meaning |
|---|---|
| `id` | Required: what the script is given as `CLAUDE_UI_VIEW`, and what a layout entry's `view` names; lowercase letters, digits, hyphens and underscores, starting with a letter or digit. |
| `label` | Required: what its button in the switch says when hovered. |
| `icon` | Required: its button's icon, by name from the app's set, as a panel's `icon` is. |

The first view is the one shown until another is picked.
A pick is kept for the panel on this machine, as a group's picked panel is, and its layout entry's `view` says which one it shows without one, an edit of it showing from the panel's next run.
An entry naming a view the list does not offer is said under the panel.

### A section

| Field | Meaning |
|---|---|
| `title` | A heading, which folds the section away and back. |
| `shut` | `true` starts it folded; only a section with a `title` can fold. |
| `tooltip` | What hovering its heading shows, such as all of what the title shortens, its line breaks kept; only a section with a `title` has a heading. |
| `empty` | What it says when it has no items. |
| `items` | Required: its rows, in order. |

### An item

| Field | Meaning |
|---|---|
| `key` | Required, unique in the list: what a session started from the row is remembered by, so keep it the same for the same thing from one run to the next. |
| `session` | The session the row is, by its full id, as `open-session` takes it: its status dot shows before the row's actions, in place of the dot of a session the row started, and the session's menu is behind the row's ⋮, the row's actions beyond its buttons first in it. |
| `lead` | A short mark before the text, such as a letter for a kind of thing, in a column of its own so the texts after marks of one length line up. |
| `leadTone` | The lead's colour, from the same words as `tone`: the colour a tone puts on a row's edge, the grey of the `detail` for `normal`, and dimmed for `muted`. |
| `text` | Required: the row's first line. |
| `cut` | Where `text` too long for its line is cut short: at its end, or at its start, which keeps its end in view, such as a path's file name; a text cut at its start keeps to one line. |
| `trail` | A short text at the end of the first line, such as a count, which the text gives way to. |
| `tooltip` | What hovering the row's first line shows, such as all of what that line shortens, its line breaks kept. |
| `detail` | Lines under the first, smaller: an array of lines, each an array of parts (below), drawn in order with the `separator` between them. |
| `separator` | What goes between the parts of its own `detail` lines, in place of the list's; a row it holds takes the list's, not this. |
| `press` | What a press on the row does: a verb (below). |
| `tone` | How the row is marked. |
| `actions` | What the row offers, at its end: the first as many as the list's `buttons` says as buttons, in order, and the rest in a menu behind a ⋮ after them, by their `label`. |
| `children` | Rows under this one, as items, drawn a step further in, which it folds away and back from a chevron, or from a press on it outside its buttons, its marks and its parts with a `press`, when it has no `press` of its own; a section's count counts the rows that hold none. |
| `shut` | `true` starts the row folded; only a row with `children` can fold. |

`tone` is one of: `normal`, `attention`, `positive`, `muted`, `danger`.
`attention`, `positive` and `danger` mark the row's leading edge in the waiting, idle and failed colours (yellow, green and red), and `muted` dims it.

`cut` is one of: `end`, `start`.
`end` is what a row without one gets.

### A text

`text`, `lead`, `trail` and `tooltip` of an item, and `text` and `tooltip` of a part, are each a string, or a list of pieces drawn one after the other, each a string or a live value (below).
A live value is filled in by the app from a session it has, and kept current between runs without running the script, so a row can say what a session is called now:

<!-- checked: list -->
```json
{ "version": 1,
  "sections": [
    { "items": [
      { "key": "b03e5cdc", "session": "b03e5cdc-8f1e-4a2b-9c3d-5e6f7a8b9c0d",
        "text": ["Review: ", { "session": "b03e5cdc-8f1e-4a2b-9c3d-5e6f7a8b9c0d", "field": "title", "else": "PR #36515" }],
        "detail": [[{ "text": "PR #36515 merged", "tone": "positive" }]],
        "press": { "open-session": "b03e5cdc-8f1e-4a2b-9c3d-5e6f7a8b9c0d" } }
    ] }
  ] }
```

A list of pieces is never empty, and a required one is never only spaces.
A string is only ever its own words: nothing inside one is read as a live value, so text the script passes on, such as a PR's title, shows as it is.

### A live value

| Field | Meaning |
|---|---|
| `session` | Required: the session's full id, as `open-session` takes it. |
| `field` | Required: what of the session it says. |
| `else` | What it says when the app has no session of that id, never empty; "Unavailable" without one. |

A live value's `field` is one of: `title`.
`title` is what the session is called everywhere in the app.

### A row's session

The dot of the session an item's `session` names shows the session's status as the session list's dot does, and hovering it names the session and its state.
A press on it marks the session read, or unread again, wherever a press on its dot in the session list would: claude waiting, a finished turn, or a needs-you reason; on a dot with nothing to mark, such as a session at work, the press is the row's.
For a session the app does not have, the row shows no dot.

### A part

A part of a `detail` line is a string, or an object:

| Field | Meaning |
|---|---|
| `text` | Required: what it says. |
| `press` | What a press on the part does, in place of what the row's does: a verb (below); a part with one is drawn as a link is. |
| `tooltip` | What hovering it shows; the app adds nothing to it, so a part that wants to show where its link goes says so here. |
| `tone` | Its colour, from the same words as a row's `tone`: the colour a tone puts on a row's edge, and dimmed for `muted`; a link takes it in place of a link's own colour. |

A string is a part with that `text` alone, so `["#1", "3d"]` and `[{ "text": "#1" }, { "text": "3d" }]` are the same line.
A line is never empty, and a part's text is never empty or only spaces: either is a mistake in the list.
Leave out a part with nothing to say, and no separator is drawn for it.

### An action

| Field | Meaning |
|---|---|
| `label` | Required: the button's word. |

And one verb, which is what pressing it does: `{ "label": "Copy id", "copy": "b03e5cdc" }`.
An action whose verb this version does not have is left out.

### A verb

What a press does is said the same way for an action, a row's `press` and a part's `press`: an object with one of these fields.

| Field | Meaning |
|---|---|
| `session` | Start a Claude session, as an object (below), from the app's own dialog. |
| `open-session` | Go to a session the app has, by its id, switching project when it has to. |
| `open-url` | Open an http or https link in your browser. |
| `copy` | Put a text on the clipboard: a string, or an object (below) to say what the app says once it is copied. |

Two verbs this version has on one object are a mistake in the list.
A `press` whose verb this version does not have counts as no `press`, so the row does what it does without one.

### A `session`

| Field | Meaning |
|---|---|
| `prompt` | Required: the session's first prompt, which a slash command such as `/review 1` runs as. |
| `name` | The session's name; the app's own new-session label without one. |
| `pr` | The page of the GitHub pull request the session is about, such as `https://github.com/org/repo/pull/1`: a new session started from the row is linked to it once its first prompt is in its transcript, before claude has acted on it, so its PR mark and PR status show from then on, and a change to the PR that needs you marks it, as for the PRs it works on. Continuing a session the row started links nothing. |

### A `copy`

| Field | Meaning |
|---|---|
| `text` | Required: what goes on the clipboard. |
| `confirm` | What the app says once it is copied, never empty, since a copy always says so; "Copied." without one. |

Everything the app draws from the list is text, never markup.
A list that breaks a rule is not drawn in part: the panel says it is unavailable, naming every mistake by where it is.
A field the app does not know is ignored, so a script written for a later version still draws here.

## What the app does with it

A panel runs its script when it is first shown, on Refresh, when you switch project or tab if its folder moves with them and it has run before, and on its `interval`, when its last run said (`next`, above), or when what it watches changes, any of which also runs while it is out of sight so the count on its icon stays current.
A run that fails, or prints something that is not a list, never shows as an empty list: with a list already there, the list stays under a line saying when the run failed and why; without one, the panel says it is unavailable, quoting stderr.
Before the first run has ended it says it is waiting.

A `session` opens the app's own dialog, which says which panel asks and about what: the project, the one the panel runs in first; the group, the one last picked from that panel there first; the name and the prompt, both to change.
Nothing starts until Start.
An `open-session` naming an id the app has no session for says so, as one finished or whose folder is gone says why it cannot open.
A row that started a session shows that session's status dot, unless it names a `session` of its own, and pressing it goes to the session; with several, it offers them all.
Pressing it again offers to continue the latest session instead, which is resumed with the prompt when it is stopped and brought into view without it when it is running.

Which session a row started is kept by the app, on this machine, in `panel-data/` beside its own data: never in the config folder, since a session id means nothing on another machine.
A session that is gone — deleted in the app, cleaned up by Claude Code's own transcript retention, removed by hand — is forgotten there the next time that panel's file is written, and at once when you delete it in the app.

## Versions

`panel.json` and the list each carry a `version`.
What a later version of the app adds is added as new fields, which this version ignores; a change that would break a type written for this version is a new `version`, which this version refuses, saying so.

## An example: recent commits

A panel of the last commits of the folder it runs in, with an Explain button on each that asks Claude what the commit changed.
It needs `node` on your `PATH`.

`panel.json`:

<!-- checked: manifest -->
```json
{ "version": 1, "kind": "list", "title": "Commits", "icon": "git", "run": "list.mjs", "interval": "1m", "options": [{ "name": "count", "kind": "text" }] }
```

`list.mjs`, executable:

```js
#!/usr/bin/env node
// The last commits of the folder the panel runs in. What goes wrong goes to stderr with a non-zero exit, which the panel quotes.
import { execFileSync } from 'node:child_process';
import { toList } from './to-list.mjs';

const count = Number(process.env.CLAUDE_UI_OPTION_COUNT ?? 20);
const log = execFileSync('git', ['log', `-${count}`, '--format=%H%x1f%h%x1f%s%x1f%an%x1f%cr'], { encoding: 'utf8' });
console.log(JSON.stringify(toList(log)));
```

`to-list.mjs`:

```js
// `git log` in the panel's folder, as a claude-ui list. Pure, so tests/ can check it without a repository.
export function toList(log) {
  const items = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, short, subject, author, when] = line.split('\x1f');
      return {
        key: sha,
        text: subject,
        detail: [[short, author, when]],
        actions: [{ label: 'Explain', session: { prompt: `Explain what commit ${short} changed, and why.`, name: `Explain ${short}` } }],
      };
    });
  return { version: 1, sections: [{ items, empty: 'No commits yet.' }] };
}
```

`tests/to-list.test.mjs`, run with `node --test` from the type's folder:

```js
// node --test, from the type's folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toList } from '../to-list.mjs';

test('a commit is a row, keyed by its hash, with an Explain action', () => {
  const list = toList('3f2a9c1e\x1f3f2a9c1\x1fFix the login redirect\x1fAna\x1f2 hours ago\n');
  assert.equal(list.version, 1);
  assert.deepEqual(list.sections[0].items[0], {
    key: '3f2a9c1e',
    text: 'Fix the login redirect',
    detail: [['3f2a9c1', 'Ana', '2 hours ago']],
    actions: [{ label: 'Explain', session: { prompt: 'Explain what commit 3f2a9c1 changed, and why.', name: 'Explain 3f2a9c1' } }],
  });
});

test('no commits is an empty list that says so', () => {
  assert.deepEqual(toList('').sections, [{ items: [], empty: 'No commits yet.' }]);
});
```

And in the layout, for the ten latest:

```json
{ "id": "commits", "type": "commits", "options": { "count": "10" } }
```
