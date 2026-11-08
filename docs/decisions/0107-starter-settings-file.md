# A launch with no settings file writes one with every default

- **Date:** 2026-10-22
- **Area:** [The config folder](../architecture/panels.md#the-config-folder)

## Decision

A launch that finds no `settings.json` writes one with every setting at its default, under a line saying what each is.

## Why

So that launch leaves a file to edit by hand.

## Turned down

- Writing it only with the first save that changes something: it left nothing to find.
- A file with every setting commented out: it pinned no default but showed no value in force.
