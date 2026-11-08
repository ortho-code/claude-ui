# Ready names claude stopped at its prompt with nothing running

- **Date:** 2026-11-08
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

The status, its label, the needs-you type `claude.ready` and its colour all use the one word, Ready.

## Why

"Finished" is the session put away and was also used for this, which read as the same thing.

## Turned down

- "Idle", the label until then: it sounds as though nothing needs doing.
- "Claude replied": claude also replies partway through.
- "Claude finished" with its subject always said: a short surface drops the subject.
- Ready as a label over the id `idle`: it would leave `settings.json` and panel scripts with a second word for the state.
