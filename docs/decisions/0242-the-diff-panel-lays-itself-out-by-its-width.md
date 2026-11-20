# The diff panel lays itself out by its own width

- **Date:** 2026-11-14
- **Area:** [The `explorer` type](../architecture/panels.md#the-explorer-type)
- **Partly replaced** by [0244](0244-files-open-in-an-editor-beside-the-session.md) on 2026-11-18: the diff panel is the list only, and a file's diff opens in the Editor; Fit, Split and Unified hold there, Fit by the Editor's width.

## Decision

The diff panel lays itself out by its own width, never the window's: below 600px its list of files sits above the diff, and from 600px beside it.
A file's diff is drawn Fit, Split or Unified, Fit by default: Fit is unified below 600px and split from 600px, and changes as the panel is resized; Split or Unified, once picked, holds at any width and is kept for the panel.

## Why

The same panel is narrow beside a session and wide in full screen, so a rule tied to the window would lay it out wrongly in one of the two.
A split diff needs room for two columns of code, and at under 600px each side is too narrow to read, so a narrow panel reads better unified and a wide one split; a person who wants one of the two whatever the width can pin it.

## Turned down

- A layout tied to the window's width: wrong for a panel that is narrow in a wide window.
- Split or unified only as a choice, with no Fit: every resize past the width would need a press to read well.
