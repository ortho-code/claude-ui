# Needs-you reasons have types, one per PR change

- **Date:** 2026-11-06
- **Area:** [Tab lifecycle: a tab can exist without a process](../architecture/terminal.md#tab-lifecycle-a-tab-can-exist-without-a-process)

## Decision

Each needs-you reason is of a type, and several changes found in one look at a PR are a reason each at the same moment, so a PR's next change replaces all of them.
An older file is read into types, one reason per change, and each reason is still written with the older form beside its type (`storedNeedsYou`).

## Why

Before then a reason was `{ "reason", "at" }`, how the app closed being the reason itself, and a PR's changes one reason holding them all in `changes`.
Writing the older form beside the type means a build from before types, which ignores `type`, reads every mark, and what it writes back reads as the same reasons.
Nothing released knows `needsYou`, so the next release drops the older form.

## Turned down

- Migrating once without the older form, as `archived` was: `meta.json.<version>.bak` is only taken when the version changes, and going back a commit would lose every mark.
