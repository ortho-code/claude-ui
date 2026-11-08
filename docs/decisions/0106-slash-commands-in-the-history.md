# A command claude runs itself counts as a request at once

- **Date:** 2026-10-22
- **Area:** [What counts as a request](../architecture/history.md#what-counts-as-a-request)

## Decision

A command claude runs itself counts as a request at once, with no reply under it; one sent to the model counts once claude answers it.

## Why

A command claude runs itself is something you did, though nothing answers it.

## Turned down

- Telling `/model` and `/clear` from `/review` by waiting for an answer, as at first, since the command line cannot tell them apart: it hid them; it let one through whenever any assistant record followed it, about a dozen on that machine, a few of them a second copy of a typed `/compact`, and hid some 250, until they were all shown.
- Leaving slash commands out altogether, the first rule: it left a session that was one `/review` doing all the work with an empty history.
