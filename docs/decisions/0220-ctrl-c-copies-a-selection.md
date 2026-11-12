# Ctrl+C copies a selection

- **Date:** 2026-11-12
- **Area:** [The `terminal` type](../architecture/panels.md#the-terminal-type)

## Decision

While something is selected in a terminal, a claude tab's or a panel's shell, Ctrl+C copies it, says so in a toast, and drops the selection; with nothing selected, Ctrl+C goes on to the program as an interrupt.
It holds on every system the app runs on.

## Why

On Linux the app has no menu, and xterm sends Ctrl+C on as `^C`, so the only key that copied a selection was Chromium's Ctrl+Insert, which few reach for.
Copying only over a selection keeps the interrupt where it is wanted, and dropping the selection with the copy means a second press always interrupts, as in Windows Terminal.
The toast is the one every copy in the app shows.

## Turned down

- Ctrl+Shift+C as the copy key instead: Ctrl+C is the key reached for, and over a selection an interrupt is rarely what is meant.
- Copying on select: it overwrites the clipboard on every drag, including one only meant to read along.
