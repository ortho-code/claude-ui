# A superseded copy is marked on its row

- **Date:** 2026-11-24
- **Area:** [Reading sessions](../architecture/sessions.md#superseded-copies)

## Decision

A session whose transcript replaced an older copy of it, which Claude Code keeps as `<id>.jsonl.superseded-<ms>` until its cleanup deletes it, carries a mark on its row.
Its tooltip says when each copy was replaced and how many of its requests the current transcript lacks, counted by the history's own rule for a request.
The app only reads the copy: it never puts it back, renames it, or writes a session from it.

## Why

The copy holds what was said only in it, such as while two claudes ran the session at once, and nothing else in the app or in `claude --resume`'s list shows it, so without a mark it is deleted unseen.
A mark on the row makes it findable, and a filter on it can come later.
Continuing from the copy, by forking a session from it or by putting it back in place of the current one, would have the app write or rename Claude Code's transcripts, which [the principles](../principles.md#claude-code-is-the-source-of-truth) rule out.

## Turned down

- No mark, the copy found only in the session's history: nothing would lead there.
- A mark that a press clears: the copy is still there, so the mark would say less than is true; it goes when the copy does.
- Forking a new session from the copy, or putting it back: the app would write a transcript.
