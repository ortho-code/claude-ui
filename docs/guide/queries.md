# Queries

The field at the top of the session list, under Grouped and Recent, searches and filters in one.
Type words to find sessions by what they say, and terms such as `is:pinned` to narrow the list by what they are.
The help button beside the field, a question mark in a circle, opens a card of the same beside the session list, where pressing a value adds its term to the field.

## Writing a query

| You type | The list shows |
|---|---|
| `fix login` | sessions with both words, each anywhere in the session's texts |
| `"fix login"` | sessions with the words together, in one text |
| `is:pinned has:pr` | sessions that are pinned and link a PR: terms side by side must all hold |
| `is:pinned AND has:pr` | the same: `AND` is a space |
| `is:pinned OR is:running` | sessions that are pinned, or whose claude runs: either side may hold |
| `-is:pinned` | every session that is not pinned |
| `-is:pinned is:running OR is:set-aside` | sessions running and not pinned, or set aside: terms side by side bind tighter than `OR` |
| `pr.state:merged,closed` | sessions that link a PR merged or closed: a comma gives any of a field's values |
| `group:"code reviews"` | a value with spaces, in quotes |

`AND` and `OR` count only in capitals; a lower-case `or` is a word.
Parentheses are not read yet, so `(` or `)` outside quotes makes a query that does not read.
Capitals do not matter anywhere else: not in a field's name, its values, a day or a word.

## Words

Each word must be in one of a session's texts: its title, its first prompt, its folder, its note, its group's name, or a PR it links, by its number or `owner/repo#number` and, with PR status on in [Settings](settings.md), by its title.
A word is matched as part of a text, so `log` finds "login"; quote a phrase to find it whole.
A session's id is matched from its start or its end only, so a pasted id, or a short form of one cut from either end, finds the session, while a short number does not match every id it happens to be in.

A word starting with `-` means not, a word whose part before a colon is letters reads as a field, and a parenthesis keeps the query from reading, so put such a word in quotes to search for it: `"-text"`, `"TODO:"`, `"is:pinned"`, `"fix(login)"`.

## Days

`active:`, `kept:` and `due:` take a day:

| Value | The day |
|---|---|
| `2026-11-01` | that date |
| `today`, `yesterday`, `tomorrow` | that day |
| `today-30d`, `today+1w` | that many days or weeks from today |

A day runs from midnight to midnight in your time zone, and the comparisons are against that day:

| Term | Holds for |
|---|---|
| `active:today` | active at any time today |
| `active:>=today-7d` | active today or in the 7 days before |
| `active:<today-30d` | last active before the day 30 days ago |
| `active:<=2026-11-01` | last active on 1 November or before |
| `active:>2026-11-01` | active after 1 November |

## Fields

| Field | Values | Holds for a session that |
|---|---|---|
| `is:` | `working` | has a tab |
| | `running` | runs claude in its tab |
| | `asking` | asks for you now, as its dot and the switcher's count say it: not marked read, not held back by its set-aside mark |
| | `unfinished` | has no tab, and is not finished or being deleted |
| | `set-aside` | is set aside, with a day or whenever |
| | `pinned` | is pinned |
| | `worktree` | shows the worktree mark |
| | `gone` | cannot run because its folder is gone |
| | `sibling` | shares its conversation with other sessions |
| | `ready-to-finish` | links a PR, and every PR it links is merged or closed |
| `has:` | `pr`, `note` | links a PR, or has a note |
| `status:` | `busy`, `waiting`, `ready`, `background` | has a claude doing that |
| `needs:` | `any` | needs you for any reason, read ones included, or whose claude waits for you, or is ready and not marked read |
| | a category: `your-turn`, `back-to-work`, `ready-to-merge`, `look-again`, `reminders`, `finish-up` | needs you for a reason in that category |
| | a type: `claude.asks`, `claude.ready`, `pr.checks-failed`, `pr.conflict`, `pr.changes-requested`, `pr.approved`, `pr.new-commits`, `pr.review-requested`, `pr.reopened`, `pr.merged`, `pr.closed`, `app.was-running`, `app.reminder` | needs you for that reason |
| `project:` | `current`, or text | is in the project on show, or in every project while All is on show; or is in a project whose name holds the text |
| `group:` | text | is in a group whose name holds it |
| `title:` | text | has a title that holds it |
| `active:` | a day | was last active then |
| `kept:` | a day | was last kept out of the review then |
| `due:` | a day | comes back from being set aside then |
| `pr:` | `own`, `reviewing`, `other`, a number, `owner/repo#number` | links a PR you wrote, review or are asked to, or neither; or that PR |
| `pr.state:` | `open`, `draft`, `merged`, `closed`, `changes-requested`, `approved`, `checks-failed`, `checks-running`, `conflict` | links a PR in that state, as GitHub says it, `approved` counting the approvals `approvals` in [Settings](settings.md) asks for |

`needs:` lists the categories and types the app ships, as `needsYou` in [Settings](settings.md) changes them ([Status and what needs you](status.md)); the card beside the field lists the ones in force when it opens.
`pr:own`, `pr:reviewing`, `pr:other`, `pr.state:` and `is:ready-to-finish` need PR status on in Settings: without it, no PR has a known state or role; `pr:` with a number or `owner/repo#number` matches the PRs a session links either way.

## The pills and the date presets

Each pill writes its term into the field: pinned `is:pinned`, open `is:working`, live `is:running`, set aside `is:set-aside`, worktree `is:worktree`, siblings `is:sibling`, linked PR `has:pr`, noted `has:note`, folder gone `is:gone`.
A pill shows on while its term is in every part of the query, and pressing it adds its term to every part, or takes it out of every part, so on `is:running OR is:set-aside` the pinned pill gives `is:running is:pinned OR is:set-aside is:pinned`.
The date presets write `active:today`, `active:>=today-7d` and `active:>=today-30d`, and Custom writes the days you pick on the calendar.
Finished is a switch among the pills rather than a term: it shows the finished sessions in place of the rest.

## When a query does not read

A term the field cannot read, such as `is:pin` on the way to `is:pinned`, is underlined, with why under the field, and the list is dimmed while it keeps showing what the last query that read showed.
With the panel shut, the query's chip turns red and says why on hover.
A query left that does not read shows nothing at the next launch until it does.
