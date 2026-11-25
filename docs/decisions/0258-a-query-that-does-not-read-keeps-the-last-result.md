# A query that does not read keeps the last result

- **Date:** 2026-11-25
- **Area:** [Reopening the way you left it](../architecture/window.md#reopening-the-way-you-left-it)

## Decision

While the query field holds a term the app cannot read, the list keeps filtering by the last query that did read, dimmed, with the term underlined and why under the field; before any did, it shows nothing.

## Why

The list follows the field as you type, and every term is unreadable for a few keys while it is typed (`is:pin` on the way to `is:pinned`), so showing nothing until it reads would empty the list at each of those keys.
The dimming says the list no longer matches the field, which a list kept as it was would otherwise hide.

## Turned down

- An empty list while a term does not read: it flickers at every key of a term.
- Filtering only on Enter or a button: it loses narrowing by words as you type, the most-used way the list is searched.
