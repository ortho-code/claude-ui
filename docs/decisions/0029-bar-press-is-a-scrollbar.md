# A press on the bar goes there at once

- **Date:** 2026-09-29
- **Area:** [The bar and the loupe](../architecture/history.md#the-bar-and-the-loupe)

## Decision

Pressing on the bar is a scrollbar's: the view goes to that point at once and follows the pointer until the button is let go.

## Why

What was wanted is a press on a point of the bar taking the view there already.

## Turned down

- Starting a drag only after 4px of travel and taking a press that did not move as a click on the loupe's entry, the first version: the view did not go to the point pressed.
