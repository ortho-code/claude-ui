# The jump's flash has no end keyframe

- **Date:** 2026-09-28
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)

## Decision

The flash has no end keyframe, so it fades into whatever the element already has.

## Turned down

- Ending on `--surface`, as it used to: right only for a group heading, and on anything else it finished by snapping to the element's own colour, which went unnoticed until a project heading was flashed.
