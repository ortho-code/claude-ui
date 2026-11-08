# A tick holds what is on show, a press clears it

- **Date:** 2026-10-07
- **Area:** [The `command` type](../architecture/panels.md#the-command-type)

## Decision

A run the interval's timer starts holds the output on show until it ends, while a press and a switch still clear the body and show the run as it prints.

## Why

A press is asked to be watched and a tick is not, and clearing on every tick would empty the panel and send it to the top unasked.

## Turned down

- Holding on a press too, the list's answer, which keeps its list through every run that has somewhere to run: it changes what Refresh does and nobody asked for that.
