# Every commit runs the fast checks

- **Date:** 2026-11-25
- **Area:** [Which checks a change needs](../architecture/build-and-checks.md#which-checks-a-change-needs)

## Decision

A pre-commit hook, installed by `mise install` along with pre-commit, runs on every commit the checks that finish in seconds and that the staged files can start: the file checks, actionlint, ESLint, the build, the tests' type-check, fallow, and every unit test and text rule.
Beyond it, a change runs only the window's checks it can reach, and the performance checks where it touches what they time, once, when the change is complete.

## Why

Choosing every check by hand from what a change could reach went wrong both ways: the whole set was run again after each fix, and the whole window suite after edits that could not reach most of it.
In the two weeks to 2026-11-25 that came to about fourteen check runs per commit, and 139 runs of the whole window suite for 134 commits, of which some 80 followed only a failed run or edits outside the paths that need it.
The fast checks together take about forty seconds, so running all of them costs less than choosing them, and a hook runs them for every commit, whoever makes it.
Every unit test runs rather than a choice by imports, since some read a doc rather than import a module.

## Turned down

- A script that also picks the window's checks: what a change reaches there is found by searching for its labels and class names, which a script cannot do reliably.
- The whole window suite in the hook: at about two and a half minutes it would make every commit slow, and most commits cannot reach most of it.
- A hook without pre-commit, from a hooks folder in the repository: it would have to stash unstaged changes and match files to checks itself, which pre-commit already does.
