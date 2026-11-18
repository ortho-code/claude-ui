# A finished session reopens in one press

- **Date:** 2026-11-18
- **Area:** [A session's menu holds everything about it](../architecture/claude.md#a-sessions-menu-holds-everything-about-it)

## Decision

Every ask that opens a session reopens a finished one: it makes the session unfinished in one write and opens it, and a toast says "Reopened" with an Undo that finishes it again.
The finished row's button is Reopen, and its menu has Reopen first; a press on the finished row itself still opens nothing.
Unfinished stays in the finished session's menu and on the bar for selecting several, and never opens anything.
An Undo pressed while claude is still starting waits for the start to end, then finishes the session.

## Why

Opening a finished session took Unfinished, then leaving the finished view to find its row, then a press.
The toast answers what [0167](0167-a-finished-session-is-never-opened.md) turned the same idea down for, that it was not clear enough about what had happened, as a toast already does when claude's own `/resume` lands in a finished session ([0091](0091-a-resume-into-a-finished-session-unfinishes-it.md)).
Unfinished on the bar has to stay a plain unfinish, since opening every ticked session would start a claude in each, so the row's button gets a word of its own rather than one word doing two things.
A finish skips a tab whose claude is still starting, so an Undo in that moment would otherwise do nothing.

## Turned down

- A press on the finished row opening it: a stray press would unfinish a session.
- The row's button keeping the name Unfinished while it also opens: Unfinished in the menu and on the bar would then mean something else.
- A Reopen button beside Unfinished on the row: the rows are already full.
- Opening it in a tab that is not started, the session staying finished until claude starts: a finished session would have a tab, which the launch and Finished otherwise rule out.
- "Open" (does not say it comes back from finished), "Unfinish and open" (long), "Resume" (the word of a tab that is not started) and "Open again".
- An Undo while claude starts saying it is still starting, rather than waiting.
