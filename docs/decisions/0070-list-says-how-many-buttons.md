# A list says how many of a row's actions are buttons

- **Date:** 2026-10-14
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

A row shows its first actions as buttons, as many as the list's `buttons` says, 1 without one, and the rest in a menu behind the app's own kebab, last on the row.

## Why

Two buttons already took about half of a story row in the 360px column it was seen in.
A type may want its rows otherwise.

## Turned down

- The rule first planned (2026-10-08), one or two actions as buttons and a kebab only past that: two buttons already took about half of a story row.
- A fixed count the list cannot change, which that rule chose so that two lists could not make one row look different: a type may want its rows otherwise.
