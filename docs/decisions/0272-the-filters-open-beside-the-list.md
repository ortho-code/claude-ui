# The filters open beside the list

- **Date:** 2026-11-25
- **Area:** [Reopening the way you left it](../architecture/window.md#reopening-the-way-you-left-it)

## Decision

The funnel at the query field's end opens the filters in a side popover beside the session list, toward the side with room, over the panel there, or over the list itself when neither side has room.
They hold the pills in words under the facets they ask about (Lifecycle, Links, Relations, Marks, Place), the date presets with their calendar, and at their foot the query's help, folded until unfolded, its fold kept for the next launch.
They shut only by the funnel, their × or Esc, and when the review opens.

## Why

A panel above the list pushed the list down every time it opened, and icon-only pills, which a 320px sidebar forced, said what they meant only on hover; beside the list there is room for words, and the list keeps its height and its place.
The help and the pills answered the same question, what can I filter by, from two buttons and two popovers on one spot; one popover with the pills first and the full list folded under them is one place to look.
A press outside does not shut them, since you type in the field and read the list beside them while they are open, as the help card settled before.

## Turned down

- A panel above the list, as before: it pushes the list down.
- A popover over the list itself: it hides what the filters narrow.
- A press outside shutting them: every press in the field or the list would.
- Keeping a help button of its own beside the field: a second way into nearly the same thing.
- Dropping the help: the fields without a pill, such as `needs:`, `status:`, `group:` and the PR fields, would have no list.
