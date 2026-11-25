# The query field is the filter

- **Date:** 2026-11-25
- **Area:** [Reopening the way you left it](../architecture/window.md#reopening-the-way-you-left-it)

## Decision

The search box is a query field in the style of GitHub's search: terms side by side must all hold, `AND` in capitals says the same, `OR` in capitals between terms for either, binding looser than AND, `-` before a term for not, a comma for any of a field's values, quotes around spaces; parentheses are not read yet, so an unquoted one anywhere, inside a word too, keeps the query from reading.
The pills and date presets write their terms into it, and show on while their term is in every part of the query; a press adds the term to every part, or takes it out of every part.
Only the finished switch stands beside the field.

## Why

The pills could only AND, so "pinned or running" and "not pinned" could not be asked, and a filter made of flags beside a text could not be said in one place.
With the field the one truth, what a pill does is visible as text, and a filter is one line to keep, restore and later save as a view.
Adding a pill's term to every part is what ANDing it with the whole query means without parentheses: `a OR b` and pinned is `a is:pinned OR b is:pinned`.

## Turned down

- The pills as flags ANDed beside the field: two places that say what filters.
- Parentheses now: no case asks for them yet, and a pill's on state reads clearly only for terms that stand in every part; they come with views, where a view's own query has to combine with a typed one.
- The finished pill as a term now: until views, the list has no base query for `-is:finished` to stand in, so the switch stays.
