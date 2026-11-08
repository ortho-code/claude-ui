# What a press does in a list is the type's, from a vocabulary of verbs

- **Date:** 2026-10-30
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

An action's button, a press on a row and a press on a part each name a verb: `session`, `open-session`, `open-url` or `copy`.
A type decides what its rows do.

## Why

A verb is a description the app carries out, so the script still only prints.

## Turned down

- The app deciding what a row does for the type, as before: a row opened its link, a button asked for a session.
