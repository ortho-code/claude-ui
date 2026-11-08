# Config files are JSONC

- **Date:** 2026-10-07
- **Area:** [The config folder](../architecture/panels.md#the-config-folder)

## Decision

Every file in the config folder is JSONC, read in one place on `jsonc-parser`.

## Why

The same parser changes a value in a file as an edit of its text, keeping every comment around it, which was tried before it was chosen.

## Turned down

- JSON5: the parser's edit of a file's text, keeping its comments, is what decided it over JSON5.
- YAML: the same, and YAML is a much larger format besides, with indentation that means something and words like `no` that read as false.
