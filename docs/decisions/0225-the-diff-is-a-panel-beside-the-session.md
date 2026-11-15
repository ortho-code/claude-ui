# The diff is a panel beside the session

- **Date:** 2026-11-14
- **Area:** [The `diff` type](../architecture/panels.md#the-diff-type)

## Decision

What changed in a checkout is shown by a panel type of the app's own, `diff`, which a layout places like any other panel, beside the session it is about.
It reads git in the checkout the panel looks in, by the rule every panel follows, and lists the changed files for one of three questions: since the branch left its base, what no remote has yet, and what is not committed.
When the whole window is wanted for it, the panel's full screen gives it that.

## Why

A change gets reviewed while the session that made it goes on working, so the diff belongs beside the session rather than in its place.
The full screen every panel already has answers the one thing an overlay was for, the room.
It is the app's own type because a list a script prints cannot draw a diff, and a layout that does not place it loses nothing.

## Turned down

- An overlay over the terminal area, as another app in this space draws its diff: it hides the session while the diff is open.
- A panel type of the person's own, a script that prints a list: a list row is text and a press, so no diff can be drawn in it.
