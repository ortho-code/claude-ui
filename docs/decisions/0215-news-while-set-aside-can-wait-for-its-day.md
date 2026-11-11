# News while set aside can wait for its day

- **Date:** 2026-11-12
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

`setAsideNews` in the settings says what a needs-you reason that comes after a session was set aside does.
`"show"`, the default, shows and counts it at once, as before.
`"wait"` mutes it, as the reasons from before the set-aside mark are, while the set-aside mark stands: until the day comes, or with whenever until the mark goes, by a prompt you send there, Finished or Clear set aside.
Either way claude's own status shows over a muted reason, and the day coming takes the read mark off.
One setting for every type of reason.

## Why

Setting a session aside can mean "not before Thursday, whatever happens", and then a PR change on Tuesday is noise that pulls it back early.
It can also mean "until Thursday, unless something changes", which is how it worked, so that stays the default and nothing changes for anyone who does not choose otherwise.
Working in the session again ends the wait either way, through claude's status and the prompt, so waiting never hides a session you are using.
The rule is the one `mutedBySetAside` already answers, so every surface that reads it, the dot, the roll-ups and a list panel's `asks`, follows the setting with nothing of its own.

## Turned down

- A choice per needs-you type, such as a merge conflict always breaking through while an approval waits: types already carry settings of their own, and a per-type choice can be added beside the global one later without breaking it.
- `"wait"` as the default: it would change what a set-aside session does for everyone without their asking.
- The names `setAsideMutes` with `"older"` or `"all"`, and `newsBreaksSetAside` as `true` or `false`: the values did not say what they do without the name beside them, and a yes-or-no could not grow a third choice.
