# A switch checks a terminal panel's options again

- **Date:** 2026-10-17
- **Area:** [The `terminal` type](../architecture/panels.md#the-terminal-type)

## Decision

A `terminal` panel checks its options again whenever where you are may have changed.

## Why

Until 2026-10-17 a switch did not check the options again, so a panel that could not run in one project stayed so in the next until it was hidden and shown or the config folder changed, and one checked at launch, before the selection had arrived, said nothing in its place until you asked for a new shell.
