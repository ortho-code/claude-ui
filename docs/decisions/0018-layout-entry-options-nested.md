# A panel's own settings nest under options

- **Date:** 2026-09-24
- **Area:** [The layout file](../architecture/panels.md#the-layout-file)

## Decision

A layout entry carries the layout's fields at its top level and the type's settings nested under `options`.

## Why

The nesting is the rule that the layout reads the layout and a panel reads its own options, made visible in the file rather than kept as a list of names the layout holds back.
A field the layout gains later can never collide with a type's setting.
Grafana's panels, the nearest thing to this file, nest theirs under `options` too, which is where the name comes from.

## Turned down

- Flat entries, the shape of Claude Code's statusline and hooks, so that a line could be pasted from one file into another: in practice that saved one line, and it made every future layout field a name no type could use.
