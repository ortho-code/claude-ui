# A set-aside list with a choice the app cannot read is not used

- **Date:** 2026-11-05
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

A list of set-aside choices with a choice the app cannot read is not used at all: the default list is in force and the choice is named under the field.

## Why

Every setting's value is either used or not.

## Turned down

- Using the choices that read: it is a list half in force that a save would then rewrite without the others.
