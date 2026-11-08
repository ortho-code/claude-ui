# A claude that resumes a session another tab runs is forced out

- **Date:** 2026-10-20
- **Area:** [A resumed session is the session it was](../architecture/terminal.md#a-resumed-session-is-the-session-it-was)

## Decision

The claude whose `/resume` takes a session another tab runs is forced out as soon as the app hears of the switch, rather than asked to leave.

## Why

In the app such a claude ignored the Ctrl-C an ask sends, three times out of three on 2026-10-20, while the two of those forced went within a second, and a probe outside the app could not make it ignore them, so the cause is not known.
It has nothing of its own to finish either way.

## Turned down

- Asking it to leave, as a stop first asks: such a claude ignored the Ctrl-C an ask sends, as above.
- A hook refusing the `/resume` instead: neither `UserPromptSubmit` nor `UserPromptExpansion` fires for it (measured: both did for a custom command).
