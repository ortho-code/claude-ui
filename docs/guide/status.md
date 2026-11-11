# Status and what needs you

## The dot

- Every session has a status dot, driven by Claude Code hooks scoped to the sessions the app launches: busy, ready, waiting for you, working in the background when a turn ends with work it started still running, and hollow when its claude is not running.
- A dot can be marked read while it shows ready, waiting or needing you and its session is not finished.
  A new status from claude, a new reason the session needs you, such as a change on its PR, or the day you set it aside until coming, makes it unread again.
- Which state a dot shows when several hold, and how each status, category and type is drawn, are yours to set, as `strength` and `looks` in [Settings](settings.md); the dot's tooltip lists every state that holds.
- The project switcher counts the sessions in other projects that need you, and a group's jump menu, the tab bar's fold and a panel's icon roll the dots of what they hold up into one.

## What needs you

A session marked as needing you has a mauve dot on its row and its tab, saying why on hover, such as that it was running when the app quit, also when the app ended without quitting.
The mark stays through a resume and a restart until you act on the session, such as typing a prompt there, closing its tab, leaving claude yourself, a `/clear`, marking it finished, or choosing Clear needs you in its kebab, and a click on the dot only marks it seen.

Each reason a session is marked as needing you for is of a type, and each type belongs to a category:

| Category | Types |
|---|---|
| `your-turn` | `claude.asks`, `claude.ready` |
| `back-to-work` | `pr.checks-failed`, `pr.conflict`, `pr.changes-requested` |
| `ready-to-merge` | `pr.approved` |
| `look-again` | `pr.reopened`, `pr.new-commits` (a PR you reviewed moved on from the commit you reviewed), `pr.review-requested` (your review was asked) |
| `reminders` | `app.was-running` (it was running when the app closed), `app.reminder` (the moment you set it aside until came) |
| `finish-up` | `pr.merged`, `pr.closed` |

`needsYou` in `settings.json` changes one by its id, `{}` until you choose otherwise:

```jsonc
"needsYou": {
  // A merge doesn't need me here: follow-ups come with their own PRs.
  "pr.merged": { "enabled": false }
}
```

`"enabled": false` switches a type off, or a whole category with all its types, and the marks it already made go; a type can also take another `label` or `category`, and a category another `label` or `order`, which take effect once something shows them.
A PR's type fires only for the `roles` it lists, your role on the PR: `"own"` for yours, `"reviewing"` for someone else's you reviewed or are asked to review, and `"other"` for someone else's with neither.
Failing checks, a conflict, changes requested and approved fire for `["own"]`, since on someone else's PR they are its author's to act on; new commits since your review and your review asked fire for `["reviewing"]`; reopened, merged and closed fire for all three.
New commits since your review mark once per review: a second push before you review again marks nothing more.
To be marked when a PR you review is ready to merge, `"pr.approved": { "roles": ["own", "reviewing"] }` in `needsYou` adds that role.
Every field you leave out stays as the app ships it, so a later version's change to it still reaches you; a `needsYou` with a mistake in any entry is not used at all, every category and type then as the app ships it, and Settings names the mistake in its Needs you section.
That section lists every category and type as they stand, each with its id and its look, which are off, which PRs a PR's type fires for, and what `needsYou` changed; Settings' Appearance section lists the strength order in force the same way.
Claude asking and claude ready are shown by its dot whatever these say.
