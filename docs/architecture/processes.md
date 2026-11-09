# Processes and the store

## Processes

The standard Electron split, with the renderer locked down:

- **Main** (`src/main`) owns the window, reads the filesystem, and will own the PTYs.
- **Preload** (`src/preload`) exposes a small typed API on `window.claudeUi` through `contextBridge`.
  `contextIsolation` is on and `nodeIntegration` is off, so the renderer never touches Node directly.
- **Renderer** (`src/renderer`) is plain DOM, no framework yet, and talks only to the preload API.

The linter holds the split: a source file importing from another process's folder fails `npm run lint`, and code both sides need goes in `src/shared`.
So does a rule of main's that the window checks' stand-in answers with, so the stand-in runs main's own code rather than a copy of it ([§ The window's checks](build-and-checks.md#the-windows-checks)), which is why some modules there are imported by main alone.
The tests are outside it, under `test/`, since a test may assert across the line — the launcher's flags against the reserved list, for one.
Inside the renderer it holds four more lines the same way: the two built-ins never import each other's modules, a service, any file in `ui/`, `dialogs/`, `status/`, `window/` or `rules/`, never imports from `panels/`, nor does `state/`, and outside `panels/types/` only the tree and the start-up (`renderer.ts`, `view-saving.ts`) import a panel type's module.
ESLint takes a rule's settings from the last block that matches a file, so each of those blocks repeats the process rule rather than adding to it (`eslint.config.mjs` says so beside them).
A unit test crosses every boundary on purpose, from inside every block, through ESLint's own API (`test/unit/boundaries.test.ts`), so a block that drops the process rule, or a pattern that misses a way of spelling a path, fails there rather than letting a crossing through.
What no lint rule here can hold, a unit test does (`test/unit/imports.test.ts`): no cycle of value imports anywhere in `src/`, read with the compiler's own parser, `import type` aside since it runs nothing.

**The window never navigates.**
Main refuses any navigation away from the app's own page and any new window (`will-navigate`, `setWindowOpenHandler`), because a page loaded there would get the preload's bridge, and the bridge runs commands.
Links leave through `shell:openExternal` instead, which accepts only http(s); the app itself never navigates, and `loadFile` is programmatic, which the event does not see.

## The store

The window's shared state goes in one store (`src/renderer/state/store.ts`) that tells its readers when it changes.
It exists because the same state is drawn by the session list, the switcher, the tab bar and the panels, and a change made in a handler that knew about one of them left the others stale: three such bugs in one day, and then the open and live filters not following the tabs.
A reader subscribes a repaint to the slices it reads and is handed a view typed as only those, so a repaint that reads a slice it did not subscribe to does not compile; a handler reads the whole state, since a click needs whatever is newest.
A repaint that reads a slice another watcher keeps current names it as read without being told — the session list reads every row's status and every section's fold, and a status change repaints only the dots, a fold only the sections — so not being told is a choice written at the subscription rather than a read nobody noticed, and nothing repaints more than it needs to.
Telling is synchronous, because some flows render and then measure — unfold a group, then scroll to its heading — and `batch` holds it to the end of a group of changes, so a read of several slices repaints once.
A slice's equality decides whether its readers are told, never what is stored, and a watcher that changes state while being told is not re-entered: what it changed is told after the round.
A watcher that throws is thrown again on its own from a microtask, an uncaught error of the window that reaches the log, rather than into whoever set the state: a repaint's failure must not cut short the flow that wrote, such as a tab's start before it binds its terminal.
A watcher is also handed its slices as they were at its last call, one that has not changed by its equality handed as it is now, so a repaint that draws only what moved compares the two instead of keeping a copy of its own: a copy compared by identity took an equal new filter, stored without telling, for a new one, and sent the list to its top.
A read from main is written as of the moment it asked (`stamp`, then `set` with `readAt`), because its answer can land after something newer: a slice written since with anything newer is left as it is, and what the read does write is as new as its asking, so a read asked later still wins whichever lands first.
Without it, the read after a delete, asked before a status event landed, wrote the older statuses back and toasted a busy session as finished; and the listing cannot instead just skip whatever was written meanwhile, since the trash moving a transcript sends a refresh of its own, which may have read the disk before the move was done.
Start-up's read is the exception, written whole: nothing can have written those slices before the first draw but a status event from a claude a crashed launch left running, and leaving start-up's statuses out for it would cost every other session's.
The settings are kept another way, by main's own count: main numbers each read of the file as it starts (`SettingsView.read`), and a change it tells of unasked is one of those reads too, read before it is sent, so the window keeps the view of the highest number rather than stamping its own; a stamp would count that telling as new when it lands, and could put back settings read before a save.
The store holds state and nothing else: a change main keeps is written by the action that makes it, as before, rather than by a watcher that would also write back what start-up had just read.
A watcher never writes back what it was told; one that takes a decision of its own writes it the way the action would, as the switcher falls back to All when the project on show has nothing left, exactly as choosing All does (`fallBackIfEmptied`).
A write two surfaces make leaves the first surface for `state/` when the second appears — the group writes (`state/groups.ts`), the status writers (`state/statuses.ts`), the project on show (`state/project.ts`) — so both make it the one way; a write only one surface makes stays with it, beside its menu or its dialog, until a second needs it.
The sidebar's view — the filter, the folds and the filter panel — is the one exception, saved by a watcher of its slices: it is one object written whole, on a debounce, and only when it differs from what was last stored or restored, so what start-up read is never written back (`view-saving.ts`, with the sidebar's part in `sessions/stored-view.ts`; the layout tree keeps its own, in the app's file beside the layout, see Panel state).
It comes back in the start-up read's own change, beside the listing, so the first draw is already the view you left, and saving starts only from there.
A tab is split along that line: what the surfaces draw of it — its session, its process, where it is in starting and stopping — is the store's, under the tab's token, and its terminal, the xterm and its element, stays with the terminal area under the same token; every step of a tab's life takes the token and reads the tab as it is at that moment.
