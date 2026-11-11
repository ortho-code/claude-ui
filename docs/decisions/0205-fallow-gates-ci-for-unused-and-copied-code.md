# Fallow gates CI for unused and copied code

- **Date:** 2026-11-11
- **Area:** [Build](../architecture/build-and-checks.md#build)

## Decision

CI fails on code that nothing uses and on copied code, as fallow finds them (`npm run fallow`, its `dead-code` and `dupes` commands), in a step after the linter.
Something kept on purpose carries a `fallow-ignore` with its reason.

## Why

The rule that a behaviour has one implementation was held only by whoever noticed a copy, and an export left behind by a split was found only by reading.
Fallow's first run found both: three readers of a transcript's tool calls, two panels forwarding the same calls to their runs, 26 names exported for no other file, and a size rule whose last caller had gone.
The run takes about ten seconds.

## Turned down

- Its `health` command, which scores complexity and churn: it reported 203 findings over its thresholds on a tree it rates good, which as a gate would need a baseline nobody reads, and splitting files by size is already the linter's ([0203](0203-a-file-past-its-size-is-split-or-says-why-not.md)).
- Running it as advice that never fails: a finding nobody has to act on piles up.
