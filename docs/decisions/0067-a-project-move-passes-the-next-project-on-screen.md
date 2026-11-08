# A project's move passes the next project on screen

- **Date:** 2026-10-14
- **Area:** [App-side metadata and session groups](../architecture/sessions.md#app-side-metadata-and-session-groups)

## Decision

A move from a project's options passes the next project on screen and leaves the rest in their slots (`movedProject`), stepping over the projects in the order that the unfiltered list does not show.

## Turned down

- Moving one slot at a time: a project put in front of such a root swapped with it on its first move down, and looked like nothing happened.
