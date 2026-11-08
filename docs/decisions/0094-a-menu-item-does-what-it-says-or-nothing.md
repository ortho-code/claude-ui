# A menu item does what it says or nothing

- **Date:** 2026-10-21
- **Area:** [A session's menu holds everything about it](../architecture/terminal.md#a-sessions-menu-holds-everything-about-it)

## Decision

A press carries the mark it was drawn with and acts only while the item would still do the same (`pressLeave`).

## Why

A press can land on an item drawn before the tab moved on, and the item by then can be another press — a Force stop pressed once claude has gone would otherwise close the tab.
