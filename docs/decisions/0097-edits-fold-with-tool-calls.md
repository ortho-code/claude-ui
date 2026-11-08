# An edit folds with the other tool calls, counted by file

- **Date:** 2026-10-21
- **Area:** [What it looks like](../architecture/history.md#what-it-looks-like)

## Decision

An edit (Edit, Write, MultiEdit, NotebookEdit) folds with the rest of a run of tool calls, and the line counts the files changed.

## Why

Edit lines were a third of the history: across 506 transcripts of 10,586 requests, 34,946 of the 103,569 lines drawn, and folding them takes it to 68,854.

## Turned down

- A line for each edit, ending a run, as edits first had: those lines were a third of the history.
- Folding a lone call too: it saves no line and hides what it acted on.
- A message no longer ending a run: it would fold the tool calls from either side of a sentence into one line, out of the order claude wrote them.
- Counting edits by call ("made N edits"): it does not say how many files.
