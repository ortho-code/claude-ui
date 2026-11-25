# A query that does not read keeps the last result

- **Date:** 2026-11-25
- **Area:** [Reopening the way you left it](../architecture/window.md#reopening-the-way-you-left-it)

## Decision

While the query field holds a term the app cannot read, the list keeps filtering by the last query that did read; before any did, it shows nothing.

## Why

The list follows the field as you type, and every term is unreadable for a few keys while it is typed (`is:pin` on the way to `is:pinned`), so showing nothing until it reads would empty the list at each of those keys.

## Turned down

- An empty list while a term does not read: it flickers at every key of a term.
- Filtering only on Enter or a button: it loses narrowing by words as you type, the most-used way the list is searched.
