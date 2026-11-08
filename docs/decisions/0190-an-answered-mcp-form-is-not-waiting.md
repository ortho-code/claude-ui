# An answered MCP form is not waiting

- **Date:** 2026-11-08
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

The hook script writes nothing for `elicitation_complete` and `elicitation_response`.

## Why

Claude 2.1.316's binary sends them once an MCP server's form is complete or has its answer, so a session whose MCP server asked through a form could go waiting after it was answered.
