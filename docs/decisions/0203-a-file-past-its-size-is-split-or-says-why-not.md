# A file past its size is split, or says why not

- **Date:** 2026-11-11
- **Area:** [Build](../architecture/build-and-checks.md#build)

## Decision

The linter fails a source file of more than 400 lines of code, and a test file of more than 700, blank lines and comments not counted.
A file that belongs together past that says so at its top, with the reason after an `eslint-disable max-lines --`, and every suppression in the code carries its reason that way.
A test file past its limit is split by the module or behaviour it covers, or says why it belongs together; no test is ever dropped or merged into another to make it fit.
No source file is named for no concept at all, such as `logic` or `utils`.

## Why

Three files had grown to between 860 and 1,190 lines without anyone choosing it, and five more past 500 lines of code, and splitting them afterwards took a stretch of work of its own.
The source limit was first set at 500, where the largest files stood once the worst were split; once every source file over 400 had been split along a seam it already had, it came down to 400, so the next file to outgrow it is split while it is still one step from its parts.
A file that grows on purpose is fine; one that grows because nothing stopped it is not, and only a check that fails makes the difference a choice someone writes down.
A catch-all name is what let one file collect the rules of every area: a file named after its area or concept has no room for what is not its own.

## Turned down

- A warning instead of an error: nothing acts on a warning.
- A list of the files allowed past the limit in the linter's config, rather than the reason at the top of each: the reason belongs beside the code it is about.
- Counting every line: comments here are long on purpose, and would push a file over for its explanations.
- Lowering the test limit to 500 with the source's: a test file that covers one module well can run long, and a tighter limit pushes toward fewer tests rather than better-placed ones; the test files split so far each covered several modules, which 700 already catches.
- No limit for test files: one file would test several modules unnoticed, as one did before it was split.
