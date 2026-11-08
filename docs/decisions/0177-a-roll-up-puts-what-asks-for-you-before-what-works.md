# A roll-up puts what asks for you before what works

- **Date:** 2026-11-06
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

A roll-up takes the strength order with what asks for you first and what works after, each in the order (`strongestNudge`).
With the default that is waiting, each category, ready, then busy, as before the order was configurable.

## Why

A roll-up answers where you are needed, and a session at work needs nothing yet, while a dot says what one session is doing.

## Turned down

- Reading the list literally for the roll-ups too: it would have put busy sessions over marked ones in the switcher.
