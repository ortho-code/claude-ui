# A file name of several words is kebab-case

- **Date:** 2026-11-11
- **Area:** [Build](../architecture/build-and-checks.md#build)

## Decision

A file or folder named after more than one word separates them with a dash, all in lowercase: `terminal-shell.ts`, `tab-bar.css`, never `terminalshell.ts`, `terminalShell.ts` or `terminal_shell.ts`.
A module's stylesheet and its test mirror take the module's name, dashes included.
Names under `src/` and `test/` carry no capital and no underscore, which a check holds; words run together are left to review, since only a word list could tell them from a single word.

## Why

Both styles had grown side by side with no rule: 43 files split their words with a dash, and about 65 files, under some 38 names (`metastore`, `paneldata`, `setasidedialog`), ran them together, which reads as one word until it is spelled out.
The dash was already a style the code used, and the one most stylesheets carry, which sit beside their module under its name.

## Turned down

- camelCase or PascalCase: on a filesystem that ignores case, as macOS's and Windows' do by default, git takes a rename that changes only a letter's case for the same file, so the old case stays committed while the imports follow the new one, and they break where case counts, such as Linux and CI.
- Underscores: nothing here used them, and they hide in a link's underline.
- Renaming each file only when it is next touched: two styles would stand side by side for as long as some file goes untouched, so the existing names are renamed in one change of their own.
