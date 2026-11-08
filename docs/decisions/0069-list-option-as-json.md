# A list option reaches the script as JSON

- **Date:** 2026-10-14
- **Area:** [Types from the config folder](../architecture/panels.md#types-from-the-config-folder)

## Decision

A list option reaches the script as JSON in the same `CLAUDE_UI_OPTION_<NAME>` variable a text does.

## Why

A variable holds a string: JSON is exact for any character, and one parse in a script.

## Turned down

- Numbered variables (`…_ACTIONS_0_BUTTON`): an option may already be named `actions_0_button`.
- One file holding every option: a second channel to keep in step with the variables.
