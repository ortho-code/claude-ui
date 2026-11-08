# The tab bar's chevron is there only with two or more rows

- **Date:** 2026-10-16
- **Area:** [UI conventions](../architecture/ui-conventions.md#ui-conventions)

## Decision

The tab bar's fold chevron is there only while the open bar has two or more rows, and a fold is kept unseen on one row.

## Why

On a bar of one row a press on the chevron changed none of the tabs or rows, only the chevron itself.

## Turned down

- The chevron on a bar of one row, as it first was until 2026-10-16: a press on it changed none of the tabs or rows, only the chevron itself.
- Unfolding whenever the bar dropped to one row: a fold chosen in All would then be lost on every switch to a project with one row.
