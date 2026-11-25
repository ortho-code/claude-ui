# The Editor splits into two sides

- **Date:** 2026-11-25
- **Area:** [The `editor` type](../architecture/panels.md#the-editor-type)

## Decision

The Editor can show two groups of tabs side by side.
Move to the other side in a tab's menu starts the split, and a tab dragged from one side's row into the other's moves there.
A file has one tab in the whole Editor, so moving it takes it from one side to the other.
A file opens on the side last pressed or last given the keys, whose file is the one the Explorer marks.
The divider between the sides is kept per session tab for the run, starting even, and a double click makes the sides even again.
A side whose last tab closes goes, ending the split.
The Editor's own buttons sit at the end of the right side's head, and Close all files closes both sides.
Only side by side: no split into rows.

## Why

Reading two files at once, such as a test beside the code it tests, is what a split is for, and moving a file between the sides covers that without one file having two tabs, which would leave two views of one file to keep apart and the Explorer no single file to mark.
A menu item is found without knowing a gesture, and the drag between rows reuses the tab strip's own drag, so neither needs drop zones on the file itself.
Opening on the side last pressed is what an editor does, and it gives the Explorer's mark and where a file opens one answer.
A side left empty only takes room and asks to be closed, so it goes by itself.

## Turned down

- The same file on both sides, each scrolled on its own: a doc per side, and no single file on show for the Explorer to mark.
- Dropping a tab on half of the file area to split: more to build, and it can come later beside the menu item.
- An empty side kept until it is closed: one more thing to close.
- A close button per side beside the Editor's own: Close all in a tab's menu already closes a side, or Close on its only tab.
- One divider share for the whole window: a split belongs to the files it shows, which are per session tab.
