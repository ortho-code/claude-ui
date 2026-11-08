# A trigger's open look shares its hover rule

- **Date:** 2026-10-01
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)

## Decision

An icon button takes its open look from the same rule as its hover (`.icon-btn…:is(:hover, .menu-open)` in `base.css`, one for each kind), so a trigger needs nothing of its own.

## Why

Open rules written per trigger, five of them kept in step by hand, missed one: a list row's session mark showed nothing at all while its menu was up.

## Turned down

- An open rule per trigger, as it used to be: the one trigger nobody remembered, a list row's session mark, showed nothing at all while its menu was up.
