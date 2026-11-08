# A dot's state is picked by one strength order

- **Date:** 2026-11-06
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

Which state a dot shows is one list, the strength order (`strength` in `settings.json`), of every status and the needs-you categories, the dot showing the first that holds.
`needs-you` in the list stands for every category it does not name, in Now's order.

## Why

A category added later then has a place in a list written before it.

## Turned down

- A list naming every category: a first launch writes every setting into `settings.json`, and a category added after would have had no place in it.
