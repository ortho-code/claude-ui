# A file past its size is split, or says why not

- **Date:** 2026-11-11
- **Area:** [Build](../architecture/build-and-checks.md#build)

## Decision

The linter fails a source file of more than 500 lines of code, and a test file of more than 700, blank lines and comments not counted.
A file that belongs together past that says so at its top, with the reason after an `eslint-disable max-lines --`, and every suppression in the code carries its reason that way.
No source file is named for no concept at all, such as `logic` or `utils`.

## Why

Three files had grown to between 860 and 1,190 lines without anyone choosing it, and five more past 500 lines of code, and splitting them afterwards took a stretch of work of its own.
A file that grows on purpose is fine; one that grows because nothing stopped it is not, and only a check that fails makes the difference a choice someone writes down.
A catch-all name is what let one file collect the rules of every area: a file named after its area or concept has no room for what is not its own.

## Turned down

- A warning instead of an error: nothing acts on a warning.
- A list of the files allowed past the limit in the linter's config, rather than the reason at the top of each: the reason belongs beside the code it is about.
- Counting every line: comments here are long on purpose, and would push a file over for its explanations.
