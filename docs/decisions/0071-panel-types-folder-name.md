# Panel types live in panel-types/

- **Date:** 2026-10-14
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

The folder of a person's own panel types is `panel-types/`.
It was `types/` until 2026-10-14, renamed before any release read it.

## Why

Each folder in it defines a TYPE, which the layout then uses for any number of panels, each with an id of its own.

## Turned down

- `panels/`: each folder in it defines a type, not a panel.
- `types/`: beside `layouts/` and `scripts/` it said too little.
