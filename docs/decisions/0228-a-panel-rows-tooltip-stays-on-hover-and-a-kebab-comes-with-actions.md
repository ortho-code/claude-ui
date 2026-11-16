# A panel row's tooltip stays on hover, and a kebab comes only with actions

- **Date:** 2026-11-16
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)

## Decision

What a panel type puts in a row's, a section heading's or a part's `tooltip` shows on hover, and nowhere else the app adds.
A type's tooltip says more about what the row already shows, such as a path the row cuts short or what a letter stands for, never something the row is there to tell.
A kebab comes only with actions: its header may say what the row or a tooltip also says, but a kebab holding nothing but such words is never added.

## Why

A press on a row that opens only what its hover says reads as nothing happening, and a kebab with no action in it reads as empty.
A type's tooltip in a tree, such as a folder's whole path, often repeats what the rows around it show; the app cannot tell where it does, and the type can.

## Turned down

- A press on a row with no press of its own opening a menu of what its tooltip says, and a ⋮ on the other rows with a tooltip: built and tried in the app, where the press seemed to show nothing and the ⋮ on a folder row of a file tree held only its name and path.
- A ⋮ on every row with a tooltip: in a list of files that is every row, about 22px of each row's width.
- Taking `tooltip` out of what a type prints: it breaks every type that sets one.
