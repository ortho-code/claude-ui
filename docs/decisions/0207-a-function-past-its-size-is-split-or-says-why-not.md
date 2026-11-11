# A function past its size is split, or says why not

- **Date:** 2026-11-11
- **Area:** [Build](../architecture/build-and-checks.md#build)

## Decision

The linter fails a source function of more than 80 lines of code, blank lines and comments not counted, the functions inside it included.
One that belongs together past that says so above it, with the reason after an `eslint-disable-next-line max-lines-per-function --`.
Tests are left out.

## Why

The file limit ([0203](0203-a-file-past-its-size-is-split-or-says-why-not.md)) left one function of 193 lines standing in a file well under it: the size that hides how a thing works was the function's, and nothing measured it.
At 80 seven functions were over, and each split along steps it already took, with no reason needed to keep any whole.

## Turned down

- A limit for tests too: a `describe` callback holds all its tests in one function, so a limit there pushes toward fewer tests, which no test file is trimmed for.
- A complexity score, as fallow's `health` gives: it reported 203 findings past its thresholds on code it rates good, which as a gate would need a baseline nobody reads.
- 60 lines from the start: sixteen functions were past it, against seven at 80; the limit can come down once those are split, as the file limit did.
