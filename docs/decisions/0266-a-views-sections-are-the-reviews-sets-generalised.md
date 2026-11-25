# A view's sections are the review's sets, generalised

- **Date:** 2026-11-25
- **Area:** [Views with sections](../architecture/session-list.md#views-with-sections)

## Decision

A view with sections is a query every section's rows meet and its sections in order, each a name, a query, a named order and what its rows say under their title; a session goes in the first section whose query holds.
The review is such a view, its two sets its sections, and Now another.
The orders are named and kept in one place beside the query's fields, each a section picks: last activity either way round, strength, project, due, and asking then project.

## Why

The review already put each session in the first of its sets whose query held, so Now's sections are the same mechanism with different data; a grouping written for Now alone would be a second way to make sections.
Named orders keep a section's definition data, and each order is written and tested once.

## Turned down

- A "group by whose turn" written for Now.
- Sort keys composed in the view's definition, which no second case needs yet.
