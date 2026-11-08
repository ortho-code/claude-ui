# Notices of something finished are not waiting

- **Date:** 2026-10-28
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

The hook script writes nothing for `auth_success`, `agent_completed` and `computer_use_exit`.

## Why

None of them asks anything.
Whether they reach the hook at all is unmeasured, and if they do not, nothing is lost.
