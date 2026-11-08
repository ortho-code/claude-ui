# A time field follows the language from the next launch

- **Date:** 2026-10-29
- **Area:** [The language](../architecture/window.md#the-language)

## Decision

A time field follows a change of the language setting from the next launch, everything else the app formats at once.

## Why

Chromium fixes a time field's format per renderer process, from the language the process starts with, and nothing measured changed the field at runtime.

## Turned down

- Replacing the window when the setting changes, which would give its renderer the new language: each session's terminal talks only to the window that started it, and closing the last window ends every session on macOS and quits elsewhere, so it is no better than a restart.
- The time field drawn in a small page of its own, made afresh in the current language, the only way found with neither a restart nor a field of the app's own: it costs a second page with its own bridge and its layering over the dialog, unproven under WSLg.
- A time field of the app's own, as text or as hour and minute lists: it would follow at once but loses the native picker.
- Everything waiting for the next launch: it would show nothing of a change until then.
- Fixing the machine's `LANG` alone: it helps one machine, while WSL starts in `C`.
