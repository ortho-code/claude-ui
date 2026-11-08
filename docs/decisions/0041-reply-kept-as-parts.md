# A reply is kept as parts, in the order claude wrote them

- **Date:** 2026-09-29
- **Area:** [What it looks like](../architecture/history.md#what-it-looks-like)

## Decision

The reader keeps a reply as `parts`: every message its own part, every tool call a one-line part where it came, drawn as claude draws one, and a run of tool calls folded in place.

## Turned down

- Joining the text into one reply and folding the tools to a count for the whole reply, the first version: it made consecutive messages one block and put every tool call in the wrong place.
- Drawing a tool call like a message, with the same dot and ink: the two were too much alike to tell apart.
