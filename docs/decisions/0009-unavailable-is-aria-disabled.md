# Unavailable is aria-disabled, never the disabled property

- **Date:** 2026-09-22
- **Area:** [A session whose folder is gone](../architecture/terminal.md#a-session-whose-folder-is-gone)

## Decision

An unavailable control is `aria-disabled`, never the `disabled` property, and the reason is the tooltip.

## Why

A natively disabled button takes no focus, so the tooltip, which shows on keyboard focus as well as on hover, could explain the refusal to the pointer only.
It once had a second reason, that Chromium sent a disabled button no mouse events at all, so its tooltip never showed even on hover; Chromium has sent it every mouse event but click, mousedown and mouseup since Chrome 109, in early 2023.

## Turned down

- The `disabled` property: a natively disabled button takes no focus.
