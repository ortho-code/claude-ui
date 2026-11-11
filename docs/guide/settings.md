# Settings

Settings, behind the gear in the sidebar's header, is in sections listed beside the one on show, with Only what differs to narrow them to what you changed.
The flags the app sets for itself are refused in the launch flags rather than allowed to break a session.

The settings are in `settings.json` in the config folder (see [the config folder](layout.md#the-config-folder) for where it is), which you can edit by hand and which Settings saves into.
A launch that finds none writes one with every setting at its default, under a line saying what each is; a default written there stays as it is, so a later version's new default is in force only where you delete that line.
For example:

```jsonc
{
  // Grep and Glob without asking, in every session
  "launchFlags": "--allowedTools Grep,Glob",
  // The sessions that were running when the app closed start again at launch
  "runningSessionsAtLaunch": "start",
  // Don't ask GitHub what it says of the sessions' PRs
  "prStatus": false
}
```

There are twelve settings: `launchFlags`, the default flags for every session the app starts, `runningSessionsAtLaunch`, what a launch does with the sessions that were running when the app closed, `prStatus`, whether the app asks GitHub what it says of the PRs your sessions link, `leaveButton`, what the button beside a session's menu on its tab does, `undoRunning`, what Undo of a close or a finish does with a tab whose claude that close or finish ended, `setAside`, the choices for setting a session aside, `setAsideTime`, the time of day a choice without one comes back at, `locale`, the language the app formats times and dates in, `strength`, which state a session's dot shows when several hold, `looks`, how each state is drawn, `needsYou`, what you change of the reasons that mark a session as needing you ([What needs you](status.md#what-needs-you)), and `approvals`, how many approvals a repository's PRs need.
`runningSessionsAtLaunch` is `"cold"` until you choose otherwise, which brings their tabs back without starting them, and `"start"` starts them again; either way they are marked as needing you, unless you switch that off (below).
`prStatus` is `true` until you choose otherwise, which colours each session's PR mark by what GitHub says, asked with `gh` on your own login, and lets a session be marked as needing you when one of its PRs changes, such as merged or changes requested; `false` asks nothing, the marks keep one colour and no PR marks a session, and turning it on again starts from the PRs as they are then.
`leaveButton` is `"stop-close"` until you choose otherwise, which stops a running session and, with a press once it has stopped, closes the tab, and `"stop-finish"` marks its session finished with that press instead; `"close"` and `"finish"` do it in one press, asking claude to leave first, and `"none"` takes the button away, leaving it to the tab's menu; it is the button on the tab, and a middle-click on the tab, which does nothing with `"none"`.
`undoRunning` is `"start"` until you choose otherwise, which starts claude again in each tab the Undo of a close or a finish puts back whose claude that close or finish ended, and `"cold"` brings those tabs back without starting them; any other tab comes back cold either way.
`setAside` is `["tomorrow", "in 1w", "whenever"]` until you choose otherwise, a list of choices, each `"whenever"`, `"in 30m"` or `"in 2h"` from the moment you press it, `"in 3d"` or `"in 1w"`, `"tomorrow"`, or `"next monday"` (or `"next mon"`), the first such day after today; a choice with a day may end in a time, such as `"next monday 08:00"`, and otherwise comes back at `setAsideTime`.
The choices are offered in the order they would come, with Pick a date… after them and Whenever last where the list has it, whatever order the list has; two that come at the same moment are offered once, and a list with a choice the app cannot read is not used, which Settings names under its field.
`setAsideTime` is `"09:00"` until you choose otherwise, a time of day as `"HH:MM"` in 24 hours, and Pick a date…'s time starts at it.
`locale` is `""` until you choose otherwise, the system's language, and takes a language tag such as `"en-GB"` or `"nl-NL"`: a time field, such as Pick a date…'s, shows its hours as that language does, 24 or AM/PM, the moment a session's time gives on hover and the times on a list panel's line about a failed run are written in it, and the calendars start their weeks on its first day.
A language tag is needed because a system whose `LANG` is `C.UTF-8`, as a WSL distribution starts, reads as US English, with AM/PM and weeks from Sunday.
`strength` is `["waiting", "busy", "background", "needs-you", "ready", "closed"]` until you choose otherwise: the dot shows the first that holds, so claude waiting or working shows over a needs-you mark and the mark over claude ready, and the dot's tooltip and the top of its options list every state in that order, after what its tab says, such as that it is stopping.
It names every status once, `"needs-you"` once, standing for every needs-you category it does not name, in their order in [What needs you](status.md#what-needs-you), and any category on its own where it should rank, such as `["waiting", "back-to-work", "busy", "background", "needs-you", "ready", "closed"]` to show a PR back to work over a busy claude.
Where the dots are rolled up, in the colour of the project switcher's count, a group's jump menu, the tab bar's fold and a panel's icon, what asks for you comes before what is at work, each in this order.
Settings has no field for it yet, and names a mistake in it in its Appearance section; a list with a mistake is not used.
`looks` is `{}` until you choose otherwise, and says how a status, `"needs-you"`, a category or a type of [What needs you](status.md#what-needs-you) is drawn, by its id, each entry the fields it changes: `colour`, one of `rosewater`, `flamingo`, `pink`, `mauve`, `red`, `maroon`, `peach`, `yellow`, `green`, `teal`, `sky`, `sapphire`, `blue`, `lavender` and `muted`, or `"#rrggbb"`; `mark`, `"dot"`, `"ring"`, `"spinner"` or the name of a panel's icon, drawn in the dot's place; `core`, a colour inside a spinner, as background work has; `pulse`, `true` or `false`; and `looksLike`, the id of another whose look it takes for every field it leaves out.
What an entry leaves out comes from what it looks like, else from its category for a type, from `"needs-you"` for a category, and from the dots as they were for a status, so a type you leave alone follows its category.
`{ "back-to-work": { "colour": "peach" } }` draws every Back to work reason as a peach dot, still pulsing as needs you does; `{ "pr.changes-requested": { "mark": "bug", "colour": "red" }, "pr.checks-failed": { "looksLike": "pr.changes-requested" } }` draws both as a red bug; `{ "finish-up": { "looksLike": "ready" } }` draws a merged or closed PR as a still green dot, its tooltip still saying which.
A look changes how a dot is drawn, never what it shows, which is the order's; on a panel's icon the dot is a plain one in the look's colour, and the attention toasts' edge takes its colour.
Your turn's types have no look of their own, since they are `"waiting"` and `"ready"`; looks with a mistake are not used, and Settings names it in its Appearance section.
`approvals` is `{}` until you choose otherwise, and says how many approvals a PR needs before it counts as approved, by repository as `owner/name`, such as `{ "acme/app": 2 }` for a team that merges on two where GitHub asks one; the name matches in any case.
A PR counts as approved when GitHub says so and, in a repository named here, once that many reviewers with write access approve: only then is its mark green and is a session marked for it, and a session's options show its count, such as "1 of 2 approvals".
A repository it does not name counts as approved when GitHub says so; Settings has no field for it yet, and names a mistake in it in its Version control section, where the setting is not used.
A save writes the settings you changed, and puts a value Settings can use in place of one in the file it cannot, as edits of the file's text, so your comments stay; it is refused while the file does not parse or does not hold an object.
Under every setting the file gives other than the default, and every value in it that is not used, Settings says the default, with a Reset that writes it back when you save; each id of `needsYou` that changes something has its own, on its row under Needs you, whose Reset empties that id's entry to `{}`, the other entries and the comments around them left as they are.
Only what differs, at the foot of the list of sections, narrows every section to those settings.
A change to the file counts from the next session you start, and for the sessions running at quit, from the next launch, or on macOS the next window opened from the Dock; a change to `prStatus`, `leaveButton`, `strength`, `looks`, `needsYou`, `approvals`, `setAside` or `setAsideTime` counts at once, the last two for what you set aside from then on, and a change to `locale` too, except in the time fields, which follow it from the next launch.
A `settings.json` you were sent sets flags on every session you start, so read it before you use it.
A mistake in the file is named in Settings: a value that is not used under its setting, whose section is marked in the list of sections, and what concerns the file rather than one value, such as a setting named twice or a key the app does not have, under the title; a file that does not parse keeps the settings it last read until it does.

## Files the app keeps

- A log file per launch and day, so a problem in an installed build can be looked at afterwards; a launch that crashed keeps its log for longer, and [Install a build](../../README.md#install-a-build) says where the logs are.
- A usage record, `usage.log` beside the app's own data, noting each time sessions are finished, set aside or kept, each opening and ending of the review, and each needs-you mark and what settled it, so how the app is used can be counted over weeks.
  It holds moments, session ids, types and counts, never a title, a prompt or a note, stays on this machine, and keeps a year.
