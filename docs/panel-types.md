# Panel types of your own

A folder under `types/` in the config folder is a panel type, named after the folder, which the layout file then uses like any built-in type.
A type is shared by copying its folder, and a type you were sent runs as you, the way a script in `scripts/` does, so read it before you drop it in.
Everything a panel does beyond running its script — opening a link, starting a Claude session — is something you press.

This document is the contract a type is written against: what goes in its folder, what its script is given and prints, and what the app does with it.
A test holds it to the app's own checkers, so a field named here is one the app reads, and one the app reads is named here.

## A type's folder

```
types/commits/
  panel.json     what the type is
  list.mjs       the script it runs
  to-list.mjs    whatever else the script needs
  tests/         its own tests, apart from the code
```

The folder's name is the type's name: lowercase letters, digits, hyphens and underscores, starting with a letter or digit.
A folder named like a built-in type (`sessions`, `claude`, `command`, `terminal`) is not read, and a note under the window says so.

## The manifest

### `panel.json`

| Field | Meaning |
|---|---|
| `version` | Required, `1`: the one shape this version of the app reads. |
| `kind` | Required: what kind of panel the type is. |
| `title` | What a panel of the type is called when its layout entry gives no `title`; the entry's id without either. |
| `icon` | Its icon on a strip of icons, by name from the app's set (see the README's Panels section); `list` without one. |
| `run` | Required: the script, a path relative to the type's folder and inside it, and executable. |
| `interval` | How often a panel of the type runs again on its own, as `30s`, `5m` or `1h`, at least `10s`; only on show and on Refresh without one. |
| `options` | Settings of the type's own, which a layout entry gives under `options` and the script gets as variables. |

`kind` is one of: `list`.
A `list` type's script prints a list, and the app draws it.

### An option

| Field | Meaning |
|---|---|
| `name` | Lowercase letters, digits and underscores, starting with a letter; the script gets it as `CLAUDE_UI_OPTION_<NAME>`. `cwd` and `interval` are the kind's own and cannot be declared. |
| `kind` | What the value is. |

An option's `kind` is one of: `text`.

A mistake in `panel.json` is named where each panel of the type would be, every mistake at once, and the panel does not run.
A field the app does not read is noted and ignored, so a manifest written for a later version still works here.

## In the layout

The layout file uses the type by its name, and its entry's `options` take the type's own and the kind's:

```json
{ "id": "commits", "type": "commits", "options": { "count": "10", "interval": "5m" } }
```

`cwd` is where the script runs: without one, the active tab's folder, or the selected project's root when no tab is open; an absolute path or one under `~/` is fixed, whatever is selected; a relative one is under that same folder, so it follows the project.
`interval` overrides the manifest's.

## What the script is given

It runs through your login shell, the same one your sessions run in, so `PATH` is the same; in the folder `cwd` says; with stdin closed; with `NO_COLOR=1` and `TERM=dumb` set; and with these variables:

### Variables

| Variable | Value |
|---|---|
| `CLAUDE_UI_PROJECT_ROOT` | the selected project's repo root, empty without one |
| `CLAUDE_UI_CWD` | the folder the script runs in |
| `CLAUDE_UI_SESSION_ID` | the active tab's session, empty without one |
| `CLAUDE_UI_CONFIG_ROOT` | the config folder |
| `CLAUDE_UI_OPTION_<NAME>` | each option the entry gives, by its name in capitals |

`CLAUDE_UI` itself is not set, so a `claude -p` the script runs is not taken for one of the app's sessions.

What it prints on stdout is the list, and nothing else may be there: what your shell's startup files print never reaches it.
What it writes on stderr is kept, and its last lines are what a failure quotes.
A run that exits other than 0 has failed; so has one still going after 30 seconds, which is stopped, and one printing more than 1 MB in all.

## What the script prints

One JSON object:

<!-- checked: list -->
```json
{ "version": 1, "badge": 2,
  "sections": [
    { "empty": "Nothing waiting on you.", "items": [
      { "key": "org/repo#1", "text": "Fix the login redirect", "detail": "#1 · 3d · someone", "href": "https://github.com/org/repo/pull/1", "tone": "attention",
        "actions": [{ "label": "Review", "session": { "prompt": "/review 1", "name": "Review #1" } }] }
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
| `sections` | Required: the sections, in order. |
| `notes` | Sentences for the line under the panel. |

### A section

| Field | Meaning |
|---|---|
| `title` | A heading, which folds the section away and back. |
| `shut` | `true` starts it folded; only a section with a `title` can fold. |
| `empty` | What it says when it has no items. |
| `items` | Required: its rows, in order. |

### An item

| Field | Meaning |
|---|---|
| `key` | Required, unique in the list: what a session started from the row is remembered by, so keep it the same for the same thing from one run to the next. |
| `text` | Required: the row's first line. |
| `detail` | A second line, smaller. |
| `href` | An http or https link, which a press on the row opens in your browser. |
| `tone` | How the row is marked. |
| `actions` | What the row offers, as buttons at its end. |

`tone` is one of: `normal`, `attention`, `muted`, `danger`.
`attention` and `danger` mark the row's leading edge in the waiting and failed colours, and `muted` dims it.

### An action

| Field | Meaning |
|---|---|
| `label` | Required: the button's word. |
| `session` | Start a Claude session. |

An action of a kind this version does not have is left out.

### A `session` action

| Field | Meaning |
|---|---|
| `prompt` | Required: the session's first prompt, which a slash command such as `/review 1` runs as. |
| `name` | The session's name; the app's own new-session label without one. |

Everything the app draws from the list is text, never markup.
A list that breaks a rule is not drawn in part: the panel says it is unavailable, naming every mistake by where it is.
A field the app does not know is ignored, so a script written for a later version still draws here.

## What the app does with it

A panel runs its script when it is first shown, on Refresh, when you switch project or tab if its folder moves with them, and on its `interval`, which also runs while it is out of sight so the count on its icon stays current.
A run that fails, or prints something that is not a list, never shows as an empty list: with a list already there, the list stays under a line saying when the run failed and why; without one, the panel says it is unavailable, quoting stderr.
Before the first run has ended it says it is waiting.

A `session` button opens the app's own dialog, which says which panel asks and about what: the project, the one the panel runs in first; the group, the one last picked from that panel there first; the name and the prompt, both to change.
Nothing starts until Start.
A row that started a session shows that session's status dot, and pressing it goes to the session; with several, it offers them all.
Pressing the button again offers to continue the latest session instead, which is resumed with the prompt when it is stopped and brought into view without it when it is running.

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
        detail: `${short} · ${author} · ${when}`,
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
    detail: '3f2a9c1 · Ana · 2 hours ago',
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
