# The diff header is two rows

- **Date:** 2026-11-25
- **Area:** [The `editor` type](../architecture/panels.md#the-editor-type)

## Decision

The Editor's diff header is two rows.
The first holds the file: its path, what it is compared with and Read only.
The second holds how it is drawn and where the stepper is: the view's menu, which picks Fit, Split or Unified; Hide whitespace and Changes only as switches that show whether they are on; and at its end the position and the stepper.
Where the second row does not fit, the position turns to numbers first (`1/7 · 2/6`, the words on hover), and then the position and the stepper wrap onto a row of their own at the right, the switches keeping their words.

## Why

The menu's button named only the view on show, and the two switches sat behind it too, so a setting that hid lines could be on with nothing on screen saying so.
On one row the path was already cut to a few letters at the width the Editor usually has, and every control added took more of it.
On a row of its own the path is only cut in a narrow Editor.
With the two switches out of it, the menu holds only the views, and its button naming the view on show hides nothing else.

## Turned down

- The views as a Fit | Split | Unified switch in the header: three words more on a row that was already full.
- The views and the switches on one row, the switches behind an options button: a setting on would still be out of sight.
- The stepper on the file's row: the path cut again in a narrow Editor.
- One row that wraps only when narrow: the header would change shape on a resize, beside Fit's own change at 600px.
- Shorter words for the switches in a narrow header: "Changes" alone does not say what it does.
